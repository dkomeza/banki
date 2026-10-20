import { readSecret, SECRETS } from "./config";
import * as docker from "./docker";
import type { GitHub } from "./github";
import { previewUrl, projectName, shortSha } from "./naming";
import { isRecord, parseJson } from "./parse";
import { type Pangolin, PangolinError } from "./pangolin";
import type { Action } from "./planner";
import type { RunResult } from "./run";

// One deploy of a PR's head, from scratch, start to finish, and the confirm of
// one that already runs at its head. Each blocks the loop: the agent runs one
// action at a time, and each step has its own timeout.
//
// A Deployment's description is public, and logs never go to GitHub: a
// failure there is one of a few fixed, short reasons, and the detail behind
// it goes to the agent's own log.

export type DeployAction = Extract<Action, { kind: "deploy" }>;
export type ConfirmAction = Extract<Action, { kind: "confirm" }>;

type Services = { github: GitHub; pangolin: Pangolin };

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
  const target: docker.ComposeTarget = {
    pr: action.pr,
    sha: action.sha,
    deployedAt: action.deployedAt,
    digests: action.digests,
  };
  await services.github.setStatus(
    action.deploymentId,
    "in_progress",
    `starting ${shortSha(action.sha)}`,
  );
  await finish(action, target, services, () => steps(action, target, services.pangolin));
}

/**
 * The head already runs, so nothing is taken down: its health is checked
 * again, and then it is routed and marked a success, or stopped and failed.
 */
export async function confirm(action: ConfirmAction, services: Services): Promise<void> {
  const target = docker.targetOf(action.project, new Date());
  console.log(`${projectName(action.pr)}: already running ${shortSha(action.sha)}, confirming it`);
  await finish(action, target, services, async () => {
    await checkHealth(target);
    await route(services.pangolin, target.pr);
  });
}

/**
 * Runs `body`, then marks the Deployment a success, or stops the Preview and
 * marks it a failure. Either way the Deployments it supersedes go inactive:
 * whatever they made is gone.
 */
async function finish(
  action: DeployAction | ConfirmAction,
  target: docker.ComposeTarget,
  services: Services,
  body: () => Promise<void>,
): Promise<void> {
  const { pr, sha, deploymentId } = action;
  let reason: string | undefined;
  try {
    await body();
  } catch (error) {
    if (error instanceof DeployFailure) {
      reason = error.reason;
    } else {
      console.error(`${projectName(pr)}: agent error: ${errorText(error)}`);
      reason = AGENT_ERROR;
    }
  }

  if (reason === undefined) {
    console.log(`${projectName(pr)}: deployed ${shortSha(sha)} at ${previewUrl(pr)}`);
    await services.github.setStatus(
      deploymentId,
      "success",
      `deployed ${shortSha(sha)}`,
      previewUrl(pr),
    );
  } else {
    // Left stopped, never retried: it waits for the next push or the PR's close.
    console.log(`${projectName(pr)}: deploy of ${shortSha(sha)} failed: ${reason}`);
    await docker.stop(target).catch((error: unknown) => {
      console.error(`${projectName(pr)}: couldn't stop it: ${errorText(error)}`);
    });
    await services.github.setStatus(deploymentId, "failure", reason);
  }
  for (const older of action.supersedes) {
    await services.github.setStatus(older, "inactive", "superseded by a newer deploy");
  }
}

async function steps(action: DeployAction, target: docker.ComposeTarget, pangolin: Pangolin) {
  // The previous project's images, so `--rmi all` removes them too. With no
  // previous project there are none, and the new ones aren't pulled yet.
  const previous =
    action.previous === undefined
      ? { ...target, digests: docker.NO_DIGESTS }
      : docker.targetOf(action.previous, action.deployedAt);
  check(await docker.down(previous), "down", "couldn't remove the previous Preview");
  check(await docker.pull(target), "pull", "couldn't pull the images");

  // Read now, so a rotated Password applies from this deploy on.
  const email = readSecret(SECRETS.previewEmail);
  const password = readSecret(SECRETS.previewPassword);
  check(await docker.setup(target, email, password), "setup");
  check(await docker.seed(target), "seed");

  const up = await docker.up(target);
  if (up.exitCode !== 0) throw new DeployFailure(await notUp(target, up));

  await checkHealth(target);
  await route(pangolin, target.pr);
}

// `up --wait` waits for `web` to run, not for Caddy to listen (it has no
// healthcheck), so the first try can be refused: a few more, a second apart.
const HEALTH_ATTEMPTS = 15;

/** `/api/health` through `web` must answer, and report the head's commit. */
async function checkHealth(target: docker.ComposeTarget): Promise<void> {
  let health = await docker.health(target);
  for (let attempt = 1; attempt < HEALTH_ATTEMPTS && health.exitCode !== 0; attempt++) {
    await Bun.sleep(1000);
    health = await docker.health(target);
  }
  if (health.exitCode !== 0) {
    console.log(`${projectName(target.pr)}: health check ${docker.failure(health)}`);
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

/** Creates or keeps the PR's Pangolin resource. */
async function route(pangolin: Pangolin, pr: number): Promise<void> {
  try {
    await pangolin.createOrKeep(pr);
  } catch (error) {
    console.error(`${projectName(pr)}: Pangolin: ${errorText(error)}`);
    throw new DeployFailure(
      error instanceof PangolinError
        ? `Pangolin: couldn't create the resource (HTTP ${error.status})`
        : "Pangolin: couldn't create the resource",
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
async function notUp(target: docker.ComposeTarget, up: RunResult): Promise<string> {
  const seconds = `after ${docker.UP_WAIT_SECONDS} s`;
  if (up.timedOut) return `not up ${seconds}`;
  const states = await docker.serviceStates(target).catch(() => []);
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
