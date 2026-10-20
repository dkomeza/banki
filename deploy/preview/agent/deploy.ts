import { readSecret, SECRETS } from "./config";
import * as docker from "./docker";
import type { GitHub } from "./github";
import { previewUrl, projectName, shortSha } from "./naming";
import { isRecord, parseJson } from "./parse";
import type { Pangolin } from "./pangolin";
import type { Action } from "./planner";
import type { RunResult } from "./run";

// One deploy of a PR's head, from scratch, start to finish. It blocks the loop:
// the agent runs one action at a time, and each step has its own timeout.

export type DeployAction = Extract<Action, { kind: "deploy" }>;

/** A step failed; `reason` is the short text the Deployment's failure shows. */
class DeployFailure extends Error {
  override name = "DeployFailure";
  constructor(readonly reason: string) {
    super(reason);
  }
}

export async function deploy(
  action: DeployAction,
  services: { github: GitHub; pangolin: Pangolin },
): Promise<void> {
  const { pr, sha, deploymentId } = action;
  const target: docker.ComposeTarget = {
    pr,
    sha,
    deployedAt: action.deployedAt,
    digests: action.digests,
  };
  await services.github.setStatus(deploymentId, "in_progress", `starting ${shortSha(sha)}`);

  let reason: string | undefined;
  try {
    await steps(action, target, services.pangolin);
  } catch (error) {
    reason =
      error instanceof DeployFailure
        ? error.reason
        : `agent error: ${error instanceof Error ? error.message : String(error)}`;
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
      console.error(`${projectName(pr)}: couldn't stop it: ${String(error)}`);
    });
    await services.github.setStatus(deploymentId, "failure", reason);
  }
  // Whatever the older Deployments made, the `down` above took away.
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

  const health = await docker.health(target);
  if (health.exitCode !== 0) {
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

  try {
    await pangolin.createOrKeep(target.pr);
  } catch (error) {
    throw new DeployFailure(`Pangolin: ${error instanceof Error ? error.message : String(error)}`);
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
