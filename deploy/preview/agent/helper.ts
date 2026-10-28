import { CLONE_DIR } from "./clone";
import { failure } from "./docker";
import { run } from "./run";

// The helper adapter (ADR-0009): a one-shot container from the agent's own
// image that runs `docker compose up -d --build` on the clone's
// agent.compose.yaml, which rebuilds the agent and replaces it. The agent
// can't run that itself: recreating its own container would kill the call
// halfway. The helper isn't part of the banki-preview project, so that `up`
// leaves it alone.

export const HELPER = "banki-preview-updater";
/** The agent's own image, as agent.compose.yaml names it. */
export const AGENT_IMAGE = "banki-preview-agent";
/** The clone's volume, as agent.compose.yaml names it. */
const CLONE_VOLUME = "banki-preview-src";
const COMPOSE_FILE = `${CLONE_DIR}/deploy/preview/agent.compose.yaml`;

/** A build and a restart; well past what either takes, short of hanging the loop forever. */
const TIMEOUT_MS = 20 * 60_000;

/**
 * The `docker run` that starts the helper for `main`, with the agent's
 * hardening, on Docker's default bridge network. It needs one: the build runs
 * in the daemon, but Buildx, here, fetches the registry tokens for the
 * Dockerfile's `# syntax` image and any base image the daemon lacks. Never the
 * agent's network, which its `up` may recreate. Compose reads the agent's env files on its side and has the daemon mount
 * the secret files from their host paths, so the secrets directory is mounted
 * at its host path, read-only. Pure, so it is unit-tested.
 */
export function helperInvocation(main: string, secretsDir: string): string[] {
  if (!/^\/[^,:\n]+$/.test(secretsDir)) {
    throw new Error(
      `BANKI_PREVIEW_SECRETS is ${JSON.stringify(secretsDir)}, not an absolute host path`,
    );
  }
  return [
    "docker",
    "run",
    "--detach",
    "--name",
    HELPER,
    "--init",
    "--read-only",
    "--tmpfs",
    "/tmp",
    "--security-opt",
    "no-new-privileges:true",
    "--cap-drop",
    "ALL",
    "--cap-add",
    "DAC_READ_SEARCH",
    "--network",
    "bridge",
    "--env",
    "HOME=/tmp",
    "--env",
    `BANKI_PREVIEW_SECRETS=${secretsDir}`,
    "--env",
    `BANKI_PREVIEW_COMMIT=${main}`,
    "--mount",
    "type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock",
    "--mount",
    `type=volume,source=${CLONE_VOLUME},target=${CLONE_DIR},readonly`,
    "--mount",
    `type=bind,source=${secretsDir},target=${secretsDir},readonly`,
    AGENT_IMAGE,
    "docker",
    "compose",
    "--file",
    COMPOSE_FILE,
    "up",
    "--detach",
    "--build",
  ];
}

/** How long a new agent waits on start for the helper that started it to finish. */
export const START_WAIT_MS = 5 * 60_000;

/**
 * Waits up to `timeoutMs` for the helper container, from this update or one
 * before, to exit, then removes it. One still running is left alone: its `up`
 * may still be recreating Newt, and killing it would leave that half done.
 * It is removed on a later call, once it has exited.
 */
export async function removeFinishedHelper(
  timeoutMs: number,
): Promise<"none" | "removed" | "running"> {
  const waited = await run(["docker", "wait", HELPER], { timeoutMs });
  if (waited.timedOut) return "running";
  // There is no helper container.
  if (waited.exitCode !== 0) return "none";
  // Without --force: it never removes a running container.
  const removed = await run(["docker", "rm", HELPER], { timeoutMs: 60_000 });
  if (removed.exitCode !== 0) throw new Error(`docker rm ${HELPER} ${failure(removed)}`);
  return "removed";
}

/**
 * Starts the helper for `main`, follows its output into the agent's log and
 * waits for it to exit. On success its `up` replaces this agent in the middle
 * of the wait, so this returns only when it didn't: with the helper's exit code.
 */
export async function runHelper(main: string, secretsDir: string): Promise<number> {
  const argv = helperInvocation(main, secretsDir);
  if ((await removeFinishedHelper(10_000)) === "running") {
    throw new Error(`an earlier ${HELPER} is still running`);
  }
  const started = await run(argv, { timeoutMs: 60_000 });
  if (started.exitCode !== 0) throw new Error(`docker run ${failure(started)}`);
  const followed = await run(["docker", "logs", "--follow", HELPER], {
    timeoutMs: TIMEOUT_MS,
    logAs: "self-update",
  });
  if (followed.timedOut) {
    // Left alone, for the same reason as on start.
    throw new Error(`${HELPER} was still running after ${TIMEOUT_MS / 60_000} minutes`);
  }
  const waited = await run(["docker", "wait", HELPER], { timeoutMs: 60_000 });
  const exitCode = Number(waited.stdout.trim());
  if (waited.exitCode !== 0 || waited.stdout.trim() === "" || !Number.isInteger(exitCode)) {
    throw new Error(`docker wait ${failure(waited)}`);
  }
  await removeFinishedHelper(60_000);
  return exitCode;
}
