import { describe, expect, test } from "bun:test";
import { newestByName, unclaimedFor } from "./flags";

// The pull agent's health, as the Dashboard infers it from GitHub alone: a
// Preview's deployment still queued, or with no status, 10 minutes after it
// was made.

const NOW = new Date("2026-10-24T02:00:00.000Z");
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString();

describe("a deployment the pull agent hasn't claimed", () => {
  test("is one still queued, or with no status, 10 minutes after it was made", () => {
    expect(unclaimedFor({ state: "queued", createdAt: ago(47) }, NOW)).toBe(47);
    expect(unclaimedFor({ state: null, createdAt: ago(10) }, NOW)).toBe(10);
  });

  test("isn't one made under 10 minutes ago, or one the agent has moved on", () => {
    expect(unclaimedFor({ state: "queued", createdAt: ago(9.9) }, NOW)).toBeUndefined();
    for (const state of ["in_progress", "success", "failure", "error", "inactive"]) {
      expect(unclaimedFor({ state, createdAt: ago(120) }, NOW)).toBeUndefined();
    }
  });

  test("can't be told without the time it was made", () => {
    expect(unclaimedFor({ state: "queued" }, NOW)).toBeUndefined();
    expect(unclaimedFor(null, NOW)).toBeUndefined();
  });
});

describe("the deployments checked", () => {
  test("are each Preview's newest, by environment and name", () => {
    const listed = [
      { id: 3, environment: "slug-preview" as const, name: "ban-11-b", createdAt: ago(50) },
      { id: 1, environment: "slug-preview" as const, name: "ban-11-b", createdAt: ago(300) },
      { id: 2, environment: "slug-preview" as const, name: "ban-11-a", createdAt: ago(60) },
      { id: 4, environment: "preview" as const, name: "PR #38", createdAt: ago(5) },
      { id: 5, environment: "preview" as const, name: "PR #38", createdAt: ago(5) },
    ];

    expect(newestByName(listed).map((found) => found.id)).toEqual([5, 3, 2]);
  });
});
