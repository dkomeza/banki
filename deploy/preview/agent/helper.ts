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
const IMAGE = "banki-preview-agent";
/** The clone's volume, as agent.compose.yaml names it. */
const CLONE_VOLUME = "banki-preview-src";
const COMPOSE_FILE = `${CLONE_DIR}/deploy/preview/agent.compose.yaml`;

/** A build and a restart; well past what either takes, short of hanging the loop forever. */
const TIMEOUT_MS = 20 * 60_000;

/**
 * The `docker run` that starts the helper for `main`, with the agent's
 * hardening and no network: it only talks to the daemon, through the socket.
 * Compose reads the agent's env files on its side and has the daemon mount
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
    "none",
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
    IMAGE,
    "docker",
    "compose",
    "--file",
    COMPOSE_FILE,
    "up",
    "--detach",
    "--build",
  ];
}

/** Removes the helper container, from this update or one before; none is fine. */
export async function removeHelper(): Promise<void> {
  await run(["docker", "rm", "--force", HELPER], { timeoutMs: 60_000 });
}

/**
 * Starts the helper for `main`, follows its output into the agent's log and
 * waits for it to exit. On success its `up` replaces this agent in the middle
 * of the wait, so this returns only when it didn't: with the helper's exit code.
 */
export async function runHelper(main: string, secretsDir: string): Promise<number> {
  const argv = helperInvocation(main, secretsDir);
  await removeHelper();
  const started = await run(argv, { timeoutMs: 60_000 });
  if (started.exitCode !== 0) throw new Error(`docker run ${failure(started)}`);
  const followed = await run(["docker", "logs", "--follow", HELPER], {
    timeoutMs: TIMEOUT_MS,
    logAs: "self-update",
  });
  if (followed.timedOut) {
    await removeHelper();
    throw new Error(`the helper was still running after ${TIMEOUT_MS / 60_000} minutes`);
  }
  const waited = await run(["docker", "wait", HELPER], { timeoutMs: 60_000 });
  const exitCode = Number(waited.stdout.trim());
  if (waited.exitCode !== 0 || waited.stdout.trim() === "" || !Number.isInteger(exitCode)) {
    throw new Error(`docker wait ${failure(waited)}`);
  }
  await removeHelper();
  return exitCode;
}
