import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { failure, run, type RunResult } from "../lib/run";
import { isCommit, syncSteps } from "./sync";

// The git adapter for the Runner's clone of `main` (ADR-0012), in the
// banki-runner-work volume. It is an ordinary clone with `origin` at the
// repo, since the Stages run in it and add their worktrees from it. The tick
// fetches only `main`, anonymously: the repo is public, so git asks the
// credential helper for a token only when a Stage pushes.

export const WORK = "/work";
export const CLONE = join(WORK, "banki");
const URL = "https://github.com/dkomeza/banki.git";

const git = (args: string[], timeoutMs = 30_000, dir = CLONE) =>
  run(["git", "-C", dir, ...args], { timeoutMs, env: { GIT_TERMINAL_PROMPT: "0" } });

function check(result: RunResult, step: string): void {
  if (result.exitCode !== 0) throw new Error(`git ${step} ${failure(result)}`);
}

/** The volume's layout: the clone, the worktrees beside it, the logs, and HOME. */
export function prepareWork(): void {
  for (const dir of ["banki", "banki-worktrees", "logs", "home"]) {
    mkdirSync(join(WORK, dir), { recursive: true });
  }
}

/**
 * Brings the clone (`dir`, from `url`, for tests) onto origin's `main`, in
 * place, and returns its commit. The first tick makes the clone.
 */
export async function syncMain(dir = CLONE, url = URL): Promise<string> {
  if (!existsSync(join(dir, ".git"))) {
    console.log(`Making the clone of ${url} in ${dir}`);
    check(
      await run(["git", "-c", "init.defaultBranch=main", "init", "--quiet", dir], {
        timeoutMs: 30_000,
      }),
      "init",
    );
    check(await git(["remote", "add", "origin", url], 30_000, dir), "remote add");
  }
  const branch = (
    await git(["symbolic-ref", "--quiet", "--short", "HEAD"], 30_000, dir)
  ).stdout.trim();
  const hasCommit =
    (await git(["rev-parse", "--verify", "--quiet", "HEAD^{commit}"], 30_000, dir)).exitCode === 0;
  for (const step of syncSteps({ branch: branch === "" ? undefined : branch, hasCommit })) {
    check(await git(step, step[0] === "fetch" ? 300_000 : 60_000, dir), step[0] ?? "");
  }
  const main = (await git(["rev-parse", "--verify", "HEAD^{commit}"], 30_000, dir)).stdout.trim();
  if (!isCommit(main)) throw new Error(`git rev-parse HEAD gave ${JSON.stringify(main)}`);
  return main;
}

/**
 * The paths that differ between two commits, or undefined when the clone
 * (`dir`, for tests) doesn't have `from`. NUL-separated, so git never quotes a
 * path it finds unusual.
 */
export async function changedPaths(
  from: string,
  to: string,
  dir = CLONE,
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
