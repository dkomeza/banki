import { existsSync } from "node:fs";
import { join } from "node:path";
import { failure } from "./docker";
import { REPO } from "./naming";
import { run, type RunResult } from "./run";
import { isCommit } from "./self-update";

// The git adapter: the agent's own clone of `main` (ADR-0009), in the
// banki-preview-src volume. It is fetched anonymously, and only
// `refs/heads/main` is ever fetched or checked out, so a pull request's branch
// never reaches the server. A person's checkout is never written to.

/** Where agent.compose.yaml mounts the clone's volume. */
export const CLONE_DIR = "/src";

const URL = `https://github.com/${REPO}.git`;
/** The one ref the clone keeps: `main` as last fetched. */
const MAIN = "refs/remotes/origin/main";

const git = (args: string[], timeoutMs = 30_000, dir = CLONE_DIR) =>
  run(["git", "-C", dir, ...args], {
    timeoutMs,
    // Anonymous: never wait for a password nobody will type.
    env: { GIT_TERMINAL_PROMPT: "0" },
  });

function check(result: RunResult, step: string): void {
  if (result.exitCode !== 0) throw new Error(`git ${step} ${failure(result)}`);
}

/**
 * Fetches `main` into the clone, which starts empty on the first run, checks
 * it out detached for the helper to build, and returns its commit.
 */
export async function fetchMain(): Promise<string> {
  if (!existsSync(join(CLONE_DIR, ".git"))) {
    console.log(`Cloning ${URL} (main only) into ${CLONE_DIR}`);
    check(
      await run(["git", "-c", "init.defaultBranch=main", "init", "--quiet", CLONE_DIR], {
        timeoutMs: 30_000,
      }),
      "init",
    );
  }
  check(
    await git(["fetch", "--quiet", "--no-tags", URL, `+refs/heads/main:${MAIN}`], 300_000),
    "fetch",
  );
  const main = (await git(["rev-parse", "--verify", `${MAIN}^{commit}`])).stdout.trim();
  if (!isCommit(main)) throw new Error(`git rev-parse main gave ${JSON.stringify(main)}`);
  check(
    await git([
      "-c",
      "advice.detachedHead=false",
      "checkout",
      "--quiet",
      "--force",
      "--detach",
      main,
    ]),
    "checkout",
  );
  return main;
}

/**
 * The paths that differ between two commits, renames as a deletion and an
 * addition, or undefined when the clone (`dir`, for tests) doesn't have
 * `from`. NUL-separated, so git never quotes a path it finds unusual.
 */
export async function changedPaths(
  from: string,
  to: string,
  dir = CLONE_DIR,
): Promise<string[] | undefined> {
  if (!isCommit(from) || !isCommit(to)) return undefined;
  const result = await git(
    ["diff", "--name-only", "-z", "--no-renames", from, to, "--"],
    30_000,
    dir,
  );
  if (result.exitCode !== 0) return undefined;
  return result.stdout.split("\0").filter((path) => path !== "");
}
