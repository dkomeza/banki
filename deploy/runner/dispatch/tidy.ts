import { type Dirent, readdirSync, rmdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { failure, run } from "../lib/run";
import { type Removal, type WorktreeFacts } from "./housekeeping";

// The files and git side of the tick's housekeeping, on the Runner's volume:
// the Stage logs, and the worktrees beside the clone of `main`. What to
// remove is housekeeping.ts's to decide.

const git = (args: string[], cwd: string, timeoutMs = 60_000) =>
  run(["git", "-C", cwd, ...args], { timeoutMs, env: { GIT_TERMINAL_PROMPT: "0" } });

/** Every file under the logs directory (one directory per issue), with when it was last written. */
export function logFiles(logs: string): { path: string; modified: Date }[] {
  let issues: Dirent[];
  try {
    issues = readdirSync(logs, { withFileTypes: true });
  } catch {
    return [];
  }
  return issues
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const dir = join(logs, entry.name);
      try {
        return readdirSync(dir).map((name) => {
          const path = join(dir, name);
          return { path, modified: statSync(path).mtime };
        });
      } catch {
        return [];
      }
    });
}

/** Removes the logs given, and each issue's directory once it is empty. */
export function removeLogs(paths: readonly string[]): void {
  for (const path of paths) {
    rmSync(path, { force: true });
    try {
      rmdirSync(join(path, ".."));
    } catch {
      // Not empty yet.
    }
  }
}

/** The worktrees git knows of beside the clone, under `worktrees`, with their branches. */
export async function listWorktrees(
  clone: string,
  worktrees: string,
): Promise<{ path: string; branch: string | undefined }[]> {
  const listed = await git(["worktree", "list", "--porcelain"], clone);
  if (listed.exitCode !== 0) throw new Error(`git worktree list ${failure(listed)}`);
  return listed.stdout
    .split("\n\n")
    .map((block) => {
      const path = /^worktree (.+)$/m.exec(block)?.[1];
      const branch = /^branch refs\/heads\/(.+)$/m.exec(block)?.[1];
      return { path, branch };
    })
    .filter(
      (entry): entry is { path: string; branch: string | undefined } =>
        entry.path?.startsWith(`${worktrees}/`) === true,
    );
}

/**
 * Whether a worktree holds anything origin doesn't: uncommitted changes, or
 * commits that are on neither origin's copy of its branch nor its pull
 * request's head (`pr`, when it has one: the branch may be gone once merged).
 */
export async function worktreeFacts(
  entry: { path: string; branch: string | undefined },
  pr: number | undefined,
): Promise<WorktreeFacts> {
  const status = await git(["status", "--porcelain"], entry.path);
  const clean = status.exitCode === 0 && status.stdout.trim() === "";
  const contains = async (ref: string) =>
    (await git(["merge-base", "--is-ancestor", "HEAD", ref], entry.path)).exitCode === 0;
  let pushed = false;
  if (entry.branch !== undefined) {
    const fetched = await git(["fetch", "--quiet", "origin", entry.branch], entry.path, 300_000);
    pushed = fetched.exitCode === 0 && (await contains("FETCH_HEAD"));
  }
  if (!pushed && pr !== undefined) {
    const fetched = await git(
      ["fetch", "--quiet", "origin", `pull/${pr}/head`],
      entry.path,
      300_000,
    );
    pushed = fetched.exitCode === 0 && (await contains("FETCH_HEAD"));
  }
  return { ...entry, clean, pushed };
}

/** As `/work-issue` step 0: stops any `ui` stack in it, removes the worktree, and deletes its local branch. */
export async function removeWorktree(
  clone: string,
  removal: Removal,
  log: (line: string) => void,
): Promise<void> {
  const down = await run(["bun", "run", "ui", "down"], { cwd: removal.path, timeoutMs: 120_000 });
  if (down.exitCode !== 0)
    log(`bun run ui down in ${removal.path} ${failure(down)}; removing it anyway`);
  const removed = await git(["worktree", "remove", removal.path], clone);
  if (removed.exitCode !== 0)
    throw new Error(`git worktree remove ${removal.path} ${failure(removed)}`);
  if (removal.branch !== undefined) {
    const deleted = await git(["branch", "-D", removal.branch], clone);
    if (deleted.exitCode !== 0) log(`git branch -D ${removal.branch} ${failure(deleted)}`);
  }
}
