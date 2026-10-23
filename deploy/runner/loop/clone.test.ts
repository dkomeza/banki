import { afterAll, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { changedPaths, pinsOnMain, syncMain } from "./clone";

// The clone's git adapter against a throwaway origin on disk. Skipped without git.

const hasGit = Bun.which("git") !== null;
const root = mkdtempSync(join(tmpdir(), "banki-runner-clone-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const origin = join(root, "origin");
const clone = join(root, "clone");

function git(dir: string, ...args: string[]): string {
  const result = Bun.spawnSync(
    ["git", "-C", dir, "-c", "user.name=t", "-c", "user.email=t@example.com", ...args],
    { stdout: "pipe", stderr: "pipe" },
  );
  if (result.exitCode !== 0) throw new Error(`git ${args[0]}: ${result.stderr.toString()}`);
  return result.stdout.toString().trim();
}

function commit(file: string, content: string): string {
  writeFileSync(join(origin, file), content);
  git(origin, "add", "--all");
  git(origin, "commit", "--quiet", "--message", "change");
  return git(origin, "rev-parse", "HEAD");
}

describe.skipIf(!hasGit)("the clone of main", () => {
  test("is made on the first tick, on main", async () => {
    git(root, "-c", "init.defaultBranch=main", "init", "--quiet", origin);
    const first = commit("README.md", "one");

    expect(await syncMain(clone, origin)).toBe(first);
    expect(git(clone, "symbolic-ref", "--short", "HEAD")).toBe("main");
    expect(git(clone, "remote", "get-url", "origin")).toBe(origin);
  });

  test("is reset to main in place, losing changes made in it", async () => {
    const second = commit("README.md", "two");
    writeFileSync(join(clone, "README.md"), "edited in the clone");

    expect(await syncMain(clone, origin)).toBe(second);
    expect(readFileSync(join(clone, "README.md"), "utf8")).toBe("two");
  });

  test("moves back onto main from another branch, and leaves that branch where it was", async () => {
    git(clone, "checkout", "--quiet", "-b", "stray");
    const stray = git(clone, "rev-parse", "HEAD");
    const third = commit("README.md", "three");

    expect(await syncMain(clone, origin)).toBe(third);
    expect(git(clone, "symbolic-ref", "--short", "HEAD")).toBe("main");
    expect(git(clone, "rev-parse", "stray")).toBe(stray);
  });

  test("lists the paths changed between two commits, or none it can tell when it lacks one", async () => {
    const from = git(clone, "rev-parse", "HEAD");
    const to = commit("Dockerfile", "FROM x");
    await syncMain(clone, origin);

    expect(await changedPaths(from, to, clone)).toEqual(["Dockerfile"]);
    expect(await changedPaths("f".repeat(40), to, clone)).toBeUndefined();
  });
});

/** A lock file in the clone's git dir, last written `minutesAgo`. */
function lock(file: string, minutesAgo: number): string {
  const path = join(clone, ".git", file);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, "");
  const then = new Date(Date.now() - minutesAgo * 60_000);
  utimesSync(path, then, then);
  return path;
}

describe.skipIf(!hasGit)("a clone a git killed mid-write", () => {
  test("syncs again once its stale index.lock, HEAD.lock and main's ref lock are cleared", async () => {
    const locks = [lock("index.lock", 30), lock("HEAD.lock", 30), lock("refs/heads/main.lock", 30)];
    const next = commit("README.md", "after a crash");

    expect(await syncMain(clone, origin)).toBe(next);
    for (const path of locks) expect(existsSync(path)).toBe(false);
  });

  test("keeps a lock under 10 minutes old, which a git may still hold, and fails the sync", async () => {
    const fresh = lock("index.lock", 1);
    commit("README.md", "while a git runs");

    const outcome = await syncMain(clone, origin).then(
      () => "synced",
      (error: unknown) => String(error),
    );

    expect(outcome).toContain("git reset");
    expect(existsSync(fresh)).toBe(true);
    rmSync(fresh);
  });

  test("leaves a worktree's lock alone, however old", async () => {
    const worktreeLock = lock("worktrees/ban-1-x/index.lock", 600);

    await syncMain(clone, origin);

    expect(existsSync(worktreeLock)).toBe(true);
    rmSync(join(clone, ".git", "worktrees"), { recursive: true, force: true });
  });
});

describe.skipIf(!hasGit)("a clone's origin", () => {
  test("is added on the next tick when the first one stopped after git init", async () => {
    const fresh = join(root, "half-made");
    git(root, "-c", "init.defaultBranch=main", "init", "--quiet", fresh);

    expect(await syncMain(fresh, origin)).toBe(git(origin, "rev-parse", "HEAD"));
    expect(git(fresh, "remote", "get-url", "origin")).toBe(origin);
  });

  test("is pointed back at the repo when it points elsewhere", async () => {
    git(clone, "remote", "set-url", "origin", join(root, "elsewhere"));

    await syncMain(clone, origin);

    expect(git(clone, "remote", "get-url", "origin")).toBe(origin);
  });
});

describe.skipIf(!hasGit)("main's pins", () => {
  test("are read from the clone's package.json and .node-version", async () => {
    commit("package.json", JSON.stringify({ packageManager: "bun@1.4.3" }));
    commit(".node-version", "24\n");
    await syncMain(clone, origin);

    expect(pinsOnMain(clone)).toEqual({ packageManager: "bun@1.4.3", nodeVersion: "24\n" });
  });

  test("are missing when the clone has neither", () => {
    expect(pinsOnMain(join(root, "nowhere"))).toEqual({
      packageManager: undefined,
      nodeVersion: undefined,
    });
  });
});
