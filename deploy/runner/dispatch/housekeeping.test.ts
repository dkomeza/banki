import { describe, expect, test } from "bun:test";
import { type Ended, expiredLogs, slugsToTakeDown, worktreesToRemove } from "./housekeeping";

// What each tick tidies: old logs, a canceled issue's Slug Previews, and the
// worktrees of issues that are over.

const NOW = new Date("2026-10-24T03:00:00.000Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 24 * 60 * 60_000);
const ended = new Map<number, Ended>([
  [5, "completed"],
  [6, "canceled"],
]);

describe("the logs", () => {
  test("go after 30 days, unless an active Stage still needs one", () => {
    const files = [
      { path: "/work/logs/BAN-1/old.jsonl", modified: daysAgo(31) },
      { path: "/work/logs/BAN-1/new.jsonl", modified: daysAgo(29) },
      { path: "/work/logs/BAN-2/paused.jsonl", modified: daysAgo(40) },
    ];

    expect(expiredLogs(files, NOW, new Set(["/work/logs/BAN-2/paused.jsonl"]))).toEqual([
      "/work/logs/BAN-1/old.jsonl",
    ]);
  });
});

describe("the Slug Previews", () => {
  test("of a canceled issue are taken down, unless they are down already", () => {
    const slugs = [
      { slug: "ban-6-a", state: "success" },
      { slug: "ban-6-b", state: "inactive" },
      { slug: "ban-6-c", state: null },
      { slug: "ban-5-a", state: "success" },
      { slug: "ban-7-a", state: "success" },
      { slug: "blue", state: "success" },
    ];

    expect(slugsToTakeDown(slugs, ended)).toEqual(["ban-6-a", "ban-6-c"]);
  });
});

const worktree = (name: string, clean = true, pushed = true) => ({
  path: `/work/banki-worktrees/${name}`,
  branch: `dkomeza/${name}`,
  clean,
  pushed,
});

describe("the worktrees", () => {
  test("of Done or Canceled issues go once clean and pushed, Variants' included", () => {
    const { remove } = worktreesToRemove(
      [
        worktree("ban-5-done"),
        worktree("ban-6-gone-proto-a"),
        worktree("ban-7-open"),
        worktree("scratch"),
      ],
      ended,
    );

    expect(remove.map((found) => found.path)).toEqual([
      "/work/banki-worktrees/ban-5-done",
      "/work/banki-worktrees/ban-6-gone-proto-a",
    ]);
  });

  test("stay while they hold work origin doesn't", () => {
    const { remove, keep } = worktreesToRemove(
      [worktree("ban-5-dirty", false), worktree("ban-6-ahead", true, false)],
      ended,
    );

    expect(remove).toEqual([]);
    expect(keep).toEqual([
      { path: "/work/banki-worktrees/ban-5-dirty", why: "it has uncommitted changes" },
      { path: "/work/banki-worktrees/ban-6-ahead", why: "it has commits origin doesn't" },
    ]);
  });
});
