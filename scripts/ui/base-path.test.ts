import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { baseWorktreePath } from "./base-path.ts";

describe("baseWorktreePath", () => {
  const sha = "0123456789abcdef0123456789abcdef01234567";

  test("is next to the main checkout, under banki-worktrees, named after the sha", () => {
    assert.equal(
      baseWorktreePath("/home/u/banki/.git", sha),
      "/home/u/banki-worktrees/.base-0123456789ab",
    );
  });

  test("is the same from every worktree, which share the main checkout's git dir", () => {
    assert.equal(
      baseWorktreePath("/home/u/banki/.git/", sha),
      baseWorktreePath("/home/u/banki/.git", sha),
    );
  });
});
