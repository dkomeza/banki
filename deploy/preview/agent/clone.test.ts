import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { changedPaths } from "./clone";

// changedPaths runs the real git against a throwaway repo. Skipped without git.

const hasGit = Bun.which("git") !== null;
const repo = mkdtempSync(join(tmpdir(), "banki-clone-"));
afterAll(() => rmSync(repo, { recursive: true, force: true }));

function git(...args: string[]): string {
  const result = Bun.spawnSync(
    ["git", "-C", repo, "-c", "user.name=t", "-c", "user.email=t@example.com", ...args],
    { stdout: "pipe", stderr: "pipe" },
  );
  if (result.exitCode !== 0) throw new Error(`git ${args[0]}: ${result.stderr.toString()}`);
  return result.stdout.toString().trim();
}

function commit(files: Record<string, string>): string {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(repo, path, ".."), { recursive: true });
    writeFileSync(join(repo, path), content);
  }
  git("add", "--all");
  git("commit", "--quiet", "--message", "change");
  return git("rev-parse", "HEAD");
}

describe.skipIf(!hasGit)("the paths changed between two commits", () => {
  test("are listed as they are, a non-ASCII or spaced name unquoted", async () => {
    git("init", "--quiet");
    const from = commit({ "README.md": "a" });
    const to = commit({ "deploy/preview/é.ts": "x", "docs/with space.md": "y" });

    const paths = await changedPaths(from, to, repo);

    expect(paths?.toSorted()).toEqual(["deploy/preview/é.ts", "docs/with space.md"]);
  });

  test("are unknown when the clone doesn't have the commit", async () => {
    const to = git("rev-parse", "HEAD");

    expect(await changedPaths("f".repeat(40), to, repo)).toBeUndefined();
  });
});
