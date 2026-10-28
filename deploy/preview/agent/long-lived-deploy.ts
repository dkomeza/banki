import { ConfigError, SECRETS } from "./config";
import { AGENT_ERROR, check, checkHealthOf, DeployFailure, errorText, notUpOf } from "./deploy";
import type { GitHub } from "./github";
import type * as longLivedDocker from "./long-lived-docker";
import type { LongLivedTarget } from "./long-lived-docker";
import { type LongLivedAction, RESETTING } from "./long-lived-planner";
import { longLivedProject, longLivedUrl, shortSha } from "./naming";

// One deploy of Edge or Production (ADR-0017), start to finish. Unlike a
// Preview's, it keeps the installation's data: the api is stopped, a
// Snapshot taken, and the new images migrate the data on their start. A
// failure restores the Snapshot and the previous images, or, when even that
// fails, leaves both services stopped. A Reset of Edge clears the data after
// its Snapshot, and sets it up and seeds it again, as a first boot does. It blocks the loop like a Preview's,
// with a timeout on each step, and its Deployment's description is one of a
// few fixed, short reasons, the detail going to the agent's log.

export type LongLivedDeployAction = Extract<LongLivedAction, { kind: "deploy" }>;

/** The Docker steps a deploy runs: long-lived-docker.ts in the agent, a fake in tests. */
export type LongLivedDockerSteps = Pick<
  typeof longLivedDocker,
  | "down"
  | "pull"
  | "setup"
  | "seed"
  | "up"
  | "serviceStates"
  | "health"
  | "stop"
  | "createVolume"
  | "removeVolume"
  | "snapshot"
  | "removeImage"
>;

export type LongLivedServices = {
  github: Pick<GitHub, "setStatus">;
  docker: LongLivedDockerSteps;
  /** Reads one of the agent's secret files (config.ts's readSecret). */
  readSecret: (name: string) => string;
  sleep: (ms: number) => Promise<void>;
};

/** How far a deploy got, which says what its failure must undo. */
type Progress = {
  /** The data volume this deploy made, or the interrupted first boot's it took over. */
  ownsVolume: boolean;
  /** Its Snapshot exists: taken now, or by the try a restart cut short. */
  snapshot: boolean;
};

export async function deployLongLived(
  action: LongLivedDeployAction,
  services: LongLivedServices,
): Promise<void> {
  const { environment, deploymentId, sha } = action;
  const name = longLivedProject(environment);
  const target: LongLivedTarget = {
    environment,
    sha,
    deployedAt: action.deployedAt,
    digests: action.digests,
  };
  const firstBoot = action.volume !== "kept";
  await services.github.setStatus(
    deploymentId,
    "in_progress",
    `${action.reset ? RESETTING : "starting "}${shortSha(sha)}`,
  );

  const progress: Progress = { ownsVolume: action.volume === "own", snapshot: false };
  let reason: string | undefined;
  try {
    await (firstBoot
      ? bootSteps(action, target, services, progress)
      : upgradeSteps(action, target, services, progress));
  } catch (error) {
    if (error instanceof DeployFailure) {
      reason = error.reason;
    } else {
      console.error(`${name}: agent error: ${errorText(error)}`);
      reason = AGENT_ERROR;
    }
  }

  if (reason === undefined) {
    const done = action.reset ? "reset to" : "deployed";
    console.log(`${name}: ${done} ${shortSha(sha)} at ${longLivedUrl(environment)}`);
    await services.github.setStatus(
      deploymentId,
      "success",
      `${done} ${shortSha(sha)}`,
      longLivedUrl(environment),
    );
    await tidy(action, services, progress);
    return;
  }

  console.log(`${name}: deploy of ${shortSha(sha)} failed: ${reason}`);
  if (firstBoot) {
    // It holds nothing but this deploy's own first boot, so it goes, and the
    // next Deployment starts afresh.
    await removeFirstBoot(target, services, progress);
    await services.github.setStatus(deploymentId, "failure", reason);
    return;
  }
  const rolledBackTo = await rollBack(action, target, services, progress);
  await services.github.setStatus(
    deploymentId,
    "failure",
    rolledBackTo === undefined
      ? `${reason}, rollback failed, stopped`
      : `${reason}, rolled back to ${shortSha(rolledBackTo)}`,
  );
}

/**
 * A first boot: a fresh data volume, labelled with this Deployment, then on
 * Edge `banki setup` and `banki seed` (ADR-0007). Production starts empty,
 * for the Maintainer's Setup by hand.
 */
async function bootSteps(
  action: LongLivedDeployAction,
  target: LongLivedTarget,
  services: LongLivedServices,
  progress: Progress,
) {
  const run = services.docker;
  if (action.volume === "own") {
    // This same Deployment's first boot, cut short: it starts over.
    check(await run.down(target), "down", "couldn't remove the interrupted first boot");
    check(
      await run.removeVolume(target.environment),
      "volume rm",
      "couldn't remove the interrupted first boot's volume",
    );
    progress.ownsVolume = false;
  }
  check(
    await run.createVolume(target.environment, action.deploymentId),
    "volume create",
    "couldn't create the data volume",
  );
  progress.ownsVolume = true;
  check(await run.pull(target), "pull", "couldn't pull the images");

  if (target.environment === "edge") await setUpAndSeed(target, services);
  await start(target, services);
}

/**
 * Edge's `banki setup`, with its own Email and Password, and `banki seed`
 * (ADR-0007), on an empty database: a first boot's, or a Reset's.
 */
async function setUpAndSeed(target: LongLivedTarget, services: LongLivedServices) {
  // Read now, so an Email or Password `bootstrap` rewrote applies to this deploy.
  let email: string;
  let password: string;
  try {
    email = services.readSecret(SECRETS.edgeEmail);
    password = services.readSecret(SECRETS.edgePassword);
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    console.error(`${longLivedProject(target.environment)}: ${error.message}`);
    throw new DeployFailure("no Edge Email or Password, run deploy/long-lived/bootstrap");
  }
  check(await services.docker.setup(target, email, password), "setup");
  check(await services.docker.seed(target), "seed");
}

/**
 * Any later deploy: the running api stopped, so the Snapshot holds every
 * write the old version made, then the new images, which migrate on start.
 * A Reset clears the database after the Snapshot, then sets it up and seeds
 * it on the new images. A retry keeps the Snapshot its first try took, and
 * clears, sets up and seeds again.
 */
async function upgradeSteps(
  action: LongLivedDeployAction,
  target: LongLivedTarget,
  services: LongLivedServices,
  progress: Progress,
) {
  const run = services.docker;
  check(await run.pull(target), "pull", "couldn't pull the images");
  check(await run.stop(target), "stop", "couldn't stop the running version");
  check(
    await run.snapshot(target.environment, ["take", action.deploymentId]),
    "snapshot",
    "couldn't take the Snapshot",
  );
  progress.snapshot = true;
  if (action.reset) {
    check(
      await run.snapshot(target.environment, ["clear"]),
      "clear",
      "couldn't clear the database",
    );
    await setUpAndSeed(target, services);
  }
  await start(target, services);
}

/** `up --wait`, then the health check of the target's commit. */
async function start(target: LongLivedTarget, services: LongLivedServices) {
  const up = await services.docker.up(target);
  if (up.exitCode !== 0) {
    throw new DeployFailure(await notUpOf(up, () => services.docker.serviceStates(target)));
  }
  await checkHealthOf(
    longLivedProject(target.environment),
    target.sha,
    () => services.docker.health(target),
    services.sleep,
  );
}

/**
 * Puts the data and the previous images back: the commit it rolled back to,
 * or undefined when that failed, leaving both services stopped so nothing
 * writes to the data until the Maintainer steps in. The Snapshot stays.
 */
async function rollBack(
  action: LongLivedDeployAction,
  target: LongLivedTarget,
  services: LongLivedServices,
  progress: Progress,
): Promise<string | undefined> {
  const name = longLivedProject(target.environment);
  const run = services.docker;
  const previous = action.rollbackTo;
  try {
    check(await run.stop(target), "stop");
    // Without a Snapshot, the new images never started on the data.
    if (progress.snapshot) {
      check(await run.snapshot(target.environment, ["restore", action.deploymentId]), "restore");
    }
    if (previous === undefined) throw new DeployFailure("no success Deployment to roll back to");
    await start({ ...target, sha: previous.sha, digests: previous.digests }, services);
    console.log(`${name}: rolled back to ${shortSha(previous.sha)}`);
    return previous.sha;
  } catch (error) {
    console.error(`${name}: rollback failed, stopping it: ${errorText(error)}`);
    const stopped = await run.stop(target).catch((stopError: unknown) => {
      console.error(`${name}: couldn't stop it: ${errorText(stopError)}`);
    });
    if (stopped !== undefined && stopped.exitCode !== 0) {
      console.error(`${name}: couldn't stop it: exited ${stopped.exitCode}`);
    }
    return undefined;
  }
}

/** Removes a failed first boot: its project and the volume it made. Failures are logged. */
async function removeFirstBoot(
  target: LongLivedTarget,
  services: LongLivedServices,
  progress: Progress,
) {
  const name = longLivedProject(target.environment);
  const quietly = async (step: string, result: Promise<{ exitCode: number }>) => {
    const done = await result.catch((error: unknown) => {
      console.error(`${name}: ${step}: ${errorText(error)}`);
    });
    if (done !== undefined && done.exitCode !== 0) {
      console.error(`${name}: ${step} exited ${done.exitCode}`);
    }
  };
  await quietly("down", services.docker.down(target));
  if (progress.ownsVolume) {
    await quietly("volume rm", services.docker.removeVolume(target.environment));
  }
}

/**
 * After a success: the newest Snapshots kept, and the installation's older
 * images removed. Neither can fail the deploy; a failure is logged.
 */
async function tidy(
  action: LongLivedDeployAction,
  services: LongLivedServices,
  progress: Progress,
) {
  const name = longLivedProject(action.environment);
  if (progress.snapshot) {
    const pruned = await services.docker
      .snapshot(action.environment, ["prune"])
      .catch((error: unknown) => {
        console.error(`${name}: snapshot prune: ${errorText(error)}`);
      });
    if (pruned !== undefined && pruned.exitCode !== 0) {
      console.error(`${name}: snapshot prune exited ${pruned.exitCode}`);
    }
  }
  for (const ref of action.staleImages) {
    // One a container still uses, or already gone, stays or is skipped.
    await services.docker.removeImage(ref).catch((error: unknown) => {
      console.error(`${name}: image rm ${ref}: ${errorText(error)}`);
    });
  }
}
