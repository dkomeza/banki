import { SECRETS, type ServiceResources } from "./config";
import * as docker from "./docker";
import type { GitHub } from "./github";
import { keyOf, type PreviewKey, previewUrl, projectName, shortSha } from "./naming";
import { isRecord, parseJson } from "./parse";
import { type Pangolin, PangolinError } from "./pangolin";
import type { Action } from "./planner";
import type { RunResult } from "./run";
import type { SlugAction } from "./slug-planner";

// One deploy of a Preview's commit, from scratch, start to finish, and the
// confirm of one that already runs at it, for either pool: a PR's head, or a
// Slug's newest Deployment. Each blocks the loop: the agent runs one action
// at a time, and each step has its own timeout.
//
// A Deployment's description is public, and logs never go to GitHub: a
// failure there is one of a few fixed, short reasons, and the detail behind
// it goes to the agent's own log.

export type DeployAction = Extract<Action | SlugAction, { kind: "deploy" }>;
export type ConfirmAction = Extract<Action | SlugAction, { kind: "confirm" }>;

/** The Docker steps a deploy runs: docker.ts in the agent, a fake in tests. */
export type DockerSteps = Pick<
  typeof docker,
  "down" | "pull" | "setup" | "seed" | "up" | "serviceStates" | "health" | "stop"
>;

/** Everything a deploy or confirm acts through, passed in so tests can fake it. */
export type Services = {
  github: Pick<GitHub, "setStatus" | "latestStatus">;
  pangolin: Pick<Pangolin, "createOrKeep">;
  docker: DockerSteps;
  /** The memory and CPU limits of the key's pool (config.ts). */
  resourcesFor: (key: PreviewKey) => ServiceResources;
  /** Reads one of the agent's secret files (config.ts's readSecret). */
  readSecret: (name: string) => string;
  sleep: (ms: number) => Promise<void>;
};

/** A step failed; `reason` is the short, fixed text the Deployment's failure shows. */
class DeployFailure extends Error {
  override name = "DeployFailure";
  constructor(readonly reason: string) {
    super(reason);
  }
}

const AGENT_ERROR = "agent error, see the agent's log";

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

export async function deploy(action: DeployAction, services: Services): Promise<void> {
  const key = keyOf(action);
  const target: docker.ComposeTarget = {
    key,
    sha: action.sha,
    deployedAt: action.deployedAt,
    digests: action.digests,
    resources: services.resourcesFor(key),
  };
  // The loop's upkeep ran since this was planned: an `in_progress` written
  // over a `down` would hide it, and the deploy would bring the Preview back.
  if (await takenDown(action, services)) {
    console.log(`${projectName(key)}: taken down before it deployed, so not deploying it`);
    return;
  }
  await services.github.setStatus(
    action.deploymentId,
    "in_progress",
    `starting ${shortSha(action.sha)}`,
  );
  await finish(action, target, services, () => steps(action, target, services));
}

/**
 * The head already runs, so nothing is taken down: its health is checked
 * again, and then it is routed and marked a success, or stopped and failed.
 */
export async function confirm(action: ConfirmAction, services: Services): Promise<void> {
  const key = keyOf(action);
  const target = docker.targetOf(action.project, new Date(), services.resourcesFor(key));
  if (await takenDown(action, services)) {
    console.log(`${projectName(key)}: taken down before it was confirmed, so not confirming it`);
    return;
  }
  console.log(`${projectName(key)}: already running ${shortSha(action.sha)}, confirming it`);
  await finish(action, target, services, async () => {
    await checkHealth(target, services);
    await route(services, key);
  });
}

/**
 * Runs `body`, then marks the Deployment a success, or stops the Preview and
 * marks it a failure. Either way the Deployments it supersedes go inactive:
 * whatever they made is gone. A Slug Preview taken down meanwhile gets
 * neither: its `inactive` stays the last word, and the next loop tears it
 * down.
 */
async function finish(
  action: DeployAction | ConfirmAction,
  target: docker.ComposeTarget,
  services: Services,
  body: () => Promise<void>,
): Promise<void> {
  const { sha, deploymentId } = action;
  const key = keyOf(action);
  let reason: string | undefined;
  try {
    await body();
  } catch (error) {
    if (error instanceof DeployFailure) {
      reason = error.reason;
    } else {
      console.error(`${projectName(key)}: agent error: ${errorText(error)}`);
      reason = AGENT_ERROR;
    }
  }

  if (await takenDown(action, services)) {
    // A success would bring it back until its time to live runs out, and a
    // failure would keep the Slug held and its images swept never.
    console.log(`${projectName(key)}: taken down while it deployed, so writing nothing`);
    if (reason !== undefined) await stopQuietly(target, services);
    return;
  }
  if (reason === undefined) {
    console.log(`${projectName(key)}: deployed ${shortSha(sha)} at ${previewUrl(key)}`);
    await services.github.setStatus(
      deploymentId,
      "success",
      `deployed ${shortSha(sha)}`,
      previewUrl(key),
    );
  } else {
    // Left stopped, never retried: it waits for the next push or the PR's
    // close, or for its Slug to be dispatched again or its time to live.
    console.log(`${projectName(key)}: deploy of ${shortSha(sha)} failed: ${reason}`);
    await stopQuietly(target, services);
    await services.github.setStatus(deploymentId, "failure", reason);
  }
  for (const older of action.supersedes) {
    await services.github.setStatus(older, "inactive", "superseded by a newer deploy");
  }
}

async function steps(action: DeployAction, target: docker.ComposeTarget, services: Services) {
  const run = services.docker;
  // The previous project's images, so `--rmi all` removes them too. With no
  // previous project there are none, and the new ones aren't pulled yet.
  const previous =
    action.previous === undefined
      ? { ...target, digests: docker.NO_DIGESTS }
      : docker.targetOf(action.previous, action.deployedAt, target.resources);
  check(await run.down(previous), "down", "couldn't remove the previous Preview");
  check(await run.pull(target), "pull", "couldn't pull the images");

  // Read now, so a rotated Password applies from this deploy on.
  const email = services.readSecret(SECRETS.previewEmail);
  const password = services.readSecret(SECRETS.previewPassword);
  check(await run.setup(target, email, password), "setup");
  check(await run.seed(target), "seed");

  const up = await run.up(target);
  if (up.exitCode !== 0) throw new DeployFailure(await notUp(target, up, services));

  await checkHealth(target, services);
  await route(services, target.key);
}

/**
 * Whether a Slug Preview's Deployment went inactive while it deployed: the
 * slug-preview workflow's `down` marks it from outside the agent, and a
 * success written over that would bring it back. A PR Preview's Deployment
 * only the agent itself marks.
 */
async function stopQuietly(target: docker.ComposeTarget, services: Services): Promise<void> {
  await services.docker.stop(target).catch((error: unknown) => {
    console.error(`${projectName(target.key)}: couldn't stop it: ${errorText(error)}`);
  });
}

async function takenDown(action: DeployAction | ConfirmAction, services: Services) {
  if (!("slug" in action)) return false;
  const status = await services.github.latestStatus(action.deploymentId).catch(() => undefined);
  return status === "inactive";
}

// `up --wait` waits for `web` to run, not for Caddy to listen (it has no
// healthcheck), so the first try can be refused: a few more, a second apart.
export const HEALTH_ATTEMPTS = 15;

/** `/api/health` through `web` must answer, and report the head's commit. */
async function checkHealth(target: docker.ComposeTarget, services: Services): Promise<void> {
  let health = await services.docker.health(target);
  for (let attempt = 1; attempt < HEALTH_ATTEMPTS && health.exitCode !== 0; attempt++) {
    await services.sleep(1000);
    health = await services.docker.health(target);
  }
  if (health.exitCode !== 0) {
    console.log(`${projectName(target.key)}: health check ${docker.failure(health)}`);
    throw new DeployFailure(
      health.timedOut
        ? "health check timed out"
        : `health check failed (wget exited ${health.exitCode})`,
    );
  }
  const commit = commitOf(health.stdout);
  if (commit !== target.sha) {
    throw new DeployFailure(
      `health reports wrong commit ${commit === undefined ? "(none)" : shortSha(commit)}`,
    );
  }
}

/**
 * Creates or keeps the Preview's Pangolin resource. A 409 is its host taken by
 * a resource the agent doesn't own, which it never touches.
 */
async function route(services: Services, key: PreviewKey): Promise<void> {
  try {
    await services.pangolin.createOrKeep(key);
  } catch (error) {
    console.error(`${projectName(key)}: Pangolin: ${errorText(error)}`);
    throw new DeployFailure(
      !(error instanceof PangolinError)
        ? "Pangolin: couldn't create the resource"
        : error.status === 409
          ? "Pangolin: host taken"
          : `Pangolin: couldn't create the resource (HTTP ${error.status})`,
    );
  }
}

/**
 * Ends the deploy when `result` failed, with `reason`, or else `<step> exited
 * <code>` or `<step> timed out`.
 */
function check(result: RunResult, step: string, reason?: string): void {
  if (result.exitCode === 0) return;
  if (result.timedOut) throw new DeployFailure(`${step} timed out`);
  throw new DeployFailure(reason ?? `${step} exited ${result.exitCode}`);
}

/** Why `up --wait` failed, from the first service that isn't up. */
async function notUp(
  target: docker.ComposeTarget,
  up: RunResult,
  services: Services,
): Promise<string> {
  const seconds = `after ${docker.UP_WAIT_SECONDS} s`;
  if (up.timedOut) return `not up ${seconds}`;
  const states = await services.docker.serviceStates(target).catch(() => []);
  for (const service of ["api", "web"]) {
    const found = states.find((state) => state.service === service);
    if (found === undefined || found.state !== "running") {
      return `${service} not running ${seconds}`;
    }
    if (found.health !== "" && found.health !== "healthy") {
      return `${service} not healthy ${seconds}`;
    }
  }
  return `not up ${seconds}`;
}

/** The `commit` of an `/api/health` body, or undefined when there is none. */
function commitOf(body: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = parseJson(body, "health");
  } catch {
    return undefined;
  }
  return isRecord(parsed) && typeof parsed.commit === "string" ? parsed.commit : undefined;
}
