import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { changedPaths, syncMain } from "./clone";

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
