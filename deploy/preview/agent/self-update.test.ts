import { describe, expect, test } from "bun:test";
import { isCommit, updateDecision } from "./self-update";

// The agent rebuilds itself from `main` when `deploy/preview/` differs between
// the commit it runs and `main` (ADR-0009). These tests give the decision what
// the clone said and check what it decides.

const RUNNING = "a".repeat(40);
const MAIN = "b".repeat(40);
const NEWER_MAIN = "c".repeat(40);

const decide = (overrides: Partial<Parameters<typeof updateDecision>[0]> = {}) =>
  updateDecision({
    running: RUNNING,
    main: MAIN,
    changedPaths: [],
    failed: new Set(),
    ...overrides,
  });

describe("the self-update decision", () => {
  test("an agent running `main` is current", () => {
    expect(decide({ running: MAIN, main: MAIN })).toEqual({ kind: "current" });
  });

  test("a change under deploy/preview/ updates it", () => {
    expect(
      decide({ changedPaths: ["apps/web/src/main.tsx", "deploy/preview/agent/planner.ts"] }),
    ).toEqual({ kind: "update", why: "deploy/preview/ changed since aaaaaaa" });
  });

  test("a change anywhere else doesn't", () => {
    const changedPaths = [
      "README.md",
      "apps/api/src/index.ts",
      "deploy/preview-notes.md",
      "deploy/previews/x",
      "docs/deploy/preview/x",
    ];

    expect(decide({ changedPaths })).toEqual({ kind: "current" });
  });

  test("an agent started by hand, with no commit, updates whatever changed", () => {
    expect(decide({ running: "", changedPaths: undefined })).toEqual({
      kind: "update",
      why: "this agent was started by hand",
    });
  });

  test("a running commit that isn't one counts as none, so it never reaches git as an option", () => {
    expect(decide({ running: "--output=/tmp/x", changedPaths: undefined })).toEqual({
      kind: "update",
      why: "this agent was started by hand",
    });
  });

  test("a running commit the clone doesn't have updates", () => {
    expect(decide({ changedPaths: undefined })).toEqual({
      kind: "update",
      why: "its commit aaaaaaa isn't on main",
    });
  });

  test("the `main` commit whose update failed isn't tried again", () => {
    const failed = new Set([MAIN]);

    expect(decide({ changedPaths: ["deploy/preview/compose.yaml"], failed })).toEqual({
      kind: "failed-before",
    });
    expect(decide({ running: "", changedPaths: undefined, failed })).toEqual({
      kind: "failed-before",
    });
  });

  test("a newer `main` after a failed one is tried", () => {
    const failed = new Set([MAIN]);

    expect(
      decide({ main: NEWER_MAIN, changedPaths: ["deploy/preview/compose.yaml"], failed }),
    ).toEqual({ kind: "update", why: "deploy/preview/ changed since aaaaaaa" });
  });
});

describe("a commit", () => {
  test("is a full, lowercase SHA-1", () => {
    expect(isCommit(RUNNING)).toBe(true);
    expect(isCommit("a".repeat(39))).toBe(false);
    expect(isCommit("A".repeat(40))).toBe(false);
    expect(isCommit(`${"a".repeat(40)}\n`)).toBe(false);
    expect(isCommit("")).toBe(false);
  });
});
