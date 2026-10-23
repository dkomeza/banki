import {
  type Dirent,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { isRecord } from "../lib/parse";
import { failure, run, type RunResult } from "../lib/run";
import { isCommit, type Lock, type Pins, remoteStep, staleLocks, syncSteps } from "./sync";

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
 * place, and returns its commit. The first tick makes the clone. Each tick
 * first makes sure `origin` is the repo and clears the locks a git killed
 * mid-write left, either of which would fail every sync from then on.
 */
export async function syncMain(dir = CLONE, url = URL, now = new Date()): Promise<string> {
  if (!existsSync(join(dir, ".git"))) {
    console.log(`Making the clone of ${url} in ${dir}`);
    check(
      await run(["git", "-c", "init.defaultBranch=main", "init", "--quiet", dir], {
        timeoutMs: 30_000,
      }),
      "init",
    );
  }
  const origin = await git(["remote", "get-url", "origin"], 30_000, dir);
  const fix = remoteStep(origin.exitCode === 0 ? origin.stdout.trim() : undefined, url);
  if (fix !== undefined) {
    console.log(`Setting the clone's origin to ${url}`);
    check(await git(fix, 30_000, dir), `remote ${fix[1] ?? ""}`);
  }
  clearStaleLocks(join(dir, ".git"), now);

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

/** Removes the stale locks in a git dir: its own `*.lock` files and those under refs/. */
function clearStaleLocks(gitDir: string, now: Date): void {
  const locks: Lock[] = [];
  const look = (relative: string) => {
    let entries: Dirent[];
    try {
      entries = readdirSync(join(gitDir, relative), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = relative === "" ? entry.name : `${relative}/${entry.name}`;
      if (entry.isDirectory() && (path === "refs" || path.startsWith("refs/"))) look(path);
      else if (entry.isFile() && entry.name.endsWith(".lock")) {
        locks.push({ path, modified: statSync(join(gitDir, path)).mtime });
      }
    }
  };
  look("");
  for (const path of staleLocks(locks, now)) {
    console.warn(`Removing ${path} from the clone's git dir: a git that died left it`);
    rmSync(join(gitDir, path), { force: true });
  }
}

/** What `main` pins bun and node to, read from the clone (`dir`, for tests) as it is. */
export function pinsOnMain(dir = CLONE): Pins {
  const read = (file: string) => {
    try {
      return readFileSync(join(dir, file), "utf8");
    } catch {
      return undefined;
    }
  };
  let packageManager: string | undefined;
  try {
    const manifest: unknown = JSON.parse(read("package.json") ?? "");
    if (isRecord(manifest) && typeof manifest.packageManager === "string") {
      packageManager = manifest.packageManager;
    }
  } catch {
    packageManager = undefined;
  }
  return { packageManager, nodeVersion: read(".node-version") };
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
