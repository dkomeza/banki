import { execFile } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { promisify } from "node:util";
import { baseWorktreePath } from "./base-path.ts";
import { withLock } from "./lock.ts";
import { isUiProcess, ROOT, UiError } from "./stack.ts";

// The base side of `ui compare`: the merge-base of this branch with main,
// checked out in a detached worktree shared by every worktree of the repo
// (see baseWorktreePath), and reused across runs.

const execFileAsync = promisify(execFile);

/** How long a `ui compare` waits for another one using the same base worktree. */
const BASE_LOCK_TIMEOUT_MS = 10 * 60_000;

/** What a failed command printed: its stderr, else its stdout, else the error's message. */
function outputOf(error: unknown): string {
  if (typeof error !== "object" || error === null) return String(error);
  for (const key of ["stderr", "stdout", "message"]) {
    const value: unknown = Reflect.get(error, key);
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return "no output";
}

/** Runs a command and returns its stdout. A failure's message has the command's own output. */
async function run(
  command: string,
  args: string[],
  { cwd, signal }: { cwd: string; signal: AbortSignal },
): Promise<string> {
  signal.throwIfAborted();
  try {
    const { stdout } = await execFileAsync(command, args, {
      cwd,
      signal,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      // A fetch that needs credentials fails instead of waiting for them.
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    return stdout;
  } catch (error) {
    signal.throwIfAborted();
    throw new UiError(`${command} ${args.join(" ")} failed: ${outputOf(error)}`);
  }
}

/**
 * The merge-base of HEAD with origin/main, after fetching main. A failed
 * fetch only warns: the last fetched origin/main still works.
 */
export async function mergeBase(signal: AbortSignal): Promise<string> {
  try {
    await run("git", ["fetch", "origin", "main"], { cwd: ROOT, signal });
  } catch (error) {
    signal.throwIfAborted();
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Couldn't fetch origin main, so comparing with the last one fetched: ${message}`);
  }
  return (await run("git", ["merge-base", "HEAD", "origin/main"], { cwd: ROOT, signal })).trim();
}

/** Creates the base worktree if it is missing, checks it is at `sha`, and installs its dependencies. */
async function prepare(root: string, sha: string, signal: AbortSignal): Promise<void> {
  if (existsSync(root)) {
    const head = (await run("git", ["rev-parse", "HEAD"], { cwd: root, signal })).trim();
    if (head !== sha) {
      throw new UiError(
        `${root} is at ${head}, not the base ${sha}. Remove it with git worktree remove --force ${root}`,
      );
    }
    console.log(`Reusing the base worktree ${root}`);
  } else {
    // A worktree folder deleted by hand is still registered until pruned.
    await run("git", ["worktree", "prune"], { cwd: ROOT, signal });
    console.log(`Creating the base worktree ${root}`);
    try {
      await run("git", ["worktree", "add", "--detach", root, sha], { cwd: ROOT, signal });
    } catch (error) {
      // Half made (an interrupt mid-checkout): gone, so the next run starts over.
      rmSync(root, { recursive: true, force: true });
      await run("git", ["worktree", "prune"], { cwd: ROOT, signal: AbortSignal.timeout(10_000) });
      throw error;
    }
  }
  console.log("Installing the base's dependencies");
  await run("bun", ["install", "--frozen-lockfile"], { cwd: root, signal });
}

/**
 * Runs `body` in the base worktree for `sha`, holding its lock throughout: the
 * worktree is created if it is missing and its dependencies installed, and two
 * `ui compare` runs with the same merge-base take turns rather than collide.
 */
export async function withBaseWorktree<T>(
  sha: string,
  signal: AbortSignal,
  body: (root: string) => Promise<T>,
): Promise<T> {
  const commonDir = (
    await run("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
      cwd: ROOT,
      signal,
    })
  ).trim();
  const root = baseWorktreePath(commonDir, sha);
  mkdirSync(dirname(root), { recursive: true });
  return withLock(
    `${root}.lock`,
    async () => {
      await prepare(root, sha, signal);
      return body(root);
    },
    {
      isHolderRunning: isUiProcess,
      signal,
      timeoutMs: BASE_LOCK_TIMEOUT_MS,
      onWait: (pid) =>
        console.log(
          `Waiting for another ui compare (process ${pid ?? "unknown"}) using ${root} to finish`,
        ),
    },
  );
}
