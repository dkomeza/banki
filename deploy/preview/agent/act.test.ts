import { describe, expect, spyOn, test } from "bun:test";
import { runActions } from "./act";
import type { Action, DockerProject } from "./planner";

// The loop runs the plan's actions one at a time. These tests give it a plan
// and a fake that fails the actions named, and check which ones ran.

const project = (pr: number): DockerProject => ({
  pr,
  sha: "a".repeat(40),
  deployedAt: new Date("2026-10-20T11:00:00Z"),
  digests: undefined,
  api: "running",
  web: "running",
});

const removal = (pr: number, reason: "evicted" | "idle"): Extract<Action, { kind: "remove" }> => ({
  kind: "remove",
  pr,
  reason,
  description: `${reason}, push to rebuild`,
  project: project(pr),
  deploymentId: pr * 100,
  resourceIds: [],
});

/** A deploy of PR `<pr>` that counts on the Previews of `needs` being gone first. */
const deploy = (pr: number, needs: number[] = []): Action => ({
  kind: "deploy",
  pr,
  sha: "b".repeat(40),
  deploymentId: pr * 100 + 1,
  digests: { api: "sha256:1", web: "sha256:2" },
  previous: undefined,
  supersedes: [],
  deployedAt: new Date("2026-10-20T12:00:00Z"),
  needs,
});

const label = (action: Action) =>
  `${action.kind} ${action.kind === "teardown" ? action.project.pr : action.pr}`;

/** Runs `actions`, failing those whose label is in `failing`; the labels of those that ran. */
async function ran(actions: Action[], failing: string[] = []): Promise<string[]> {
  const log = spyOn(console, "log").mockImplementation(() => {});
  const error = spyOn(console, "error").mockImplementation(() => {});
  const calls: string[] = [];
  try {
    await runActions(actions, label, async (action) => {
      calls.push(label(action));
      if (failing.includes(label(action))) throw new Error("boom");
    });
  } finally {
    log.mockRestore();
    error.mockRestore();
  }
  return calls;
}

describe("running a plan", () => {
  test("runs every action in order, and stops after the first deploy", async () => {
    const actions = [
      { kind: "create-deployment", pr: 4, sha: "c".repeat(40) } as const,
      removal(1, "evicted"),
      deploy(3),
      removal(2, "evicted"),
      deploy(5),
    ];

    expect(await ran(actions)).toEqual(["create-deployment 4", "remove 1", "deploy 3"]);
  });

  test("goes on past a failed action", async () => {
    const actions = [
      { kind: "create-deployment", pr: 4, sha: "c".repeat(40) } as const,
      { kind: "create-resource", pr: 6 } as const,
    ];

    expect(await ran(actions, ["create-deployment 4"])).toEqual([
      "create-deployment 4",
      "create-resource 6",
    ]);
  });

  test("skips the deploy when an eviction it needs failed, so the cap holds", async () => {
    const actions = [removal(1, "evicted"), removal(2, "evicted"), deploy(3, [1, 2]), deploy(5)];

    expect(await ran(actions, ["remove 1"])).toEqual(["remove 1", "remove 2"]);
  });

  test("skips the deploy when an idle removal it needs failed", async () => {
    const actions = [removal(1, "idle"), deploy(3, [1])];

    expect(await ran(actions, ["remove 1"])).toEqual(["remove 1"]);
  });

  test("skips the deploy when a teardown it needs failed", async () => {
    const actions: Action[] = [
      { kind: "teardown", project: project(1) },
      { kind: "create-deployment", pr: 4, sha: "c".repeat(40) },
      deploy(3, [1]),
    ];

    expect(await ran(actions, ["teardown 1"])).toEqual(["teardown 1", "create-deployment 4"]);
  });

  test("still deploys when a cleanup it doesn't need failed: there's room without it", async () => {
    const actions: Action[] = [
      { kind: "teardown", project: project(1) },
      removal(2, "idle"),
      deploy(3, [2]),
    ];

    expect(await ran(actions, ["teardown 1"])).toEqual(["teardown 1", "remove 2", "deploy 3"]);
  });

  test("still deploys when the PR's own idle removal failed: the deploy replaces it anyway", async () => {
    const actions = [removal(3, "idle"), deploy(3)];

    expect(await ran(actions, ["remove 3"])).toEqual(["remove 3", "deploy 3"]);
  });

  test("still deploys when an action that frees no room failed", async () => {
    const actions: Action[] = [
      { kind: "mark-inactive", pr: 1, deploymentId: 100, reason: "closed" },
      { kind: "delete-resource", pr: 1, resourceId: 10 },
      deploy(3),
    ];

    expect(await ran(actions, ["mark-inactive 1", "delete-resource 1"])).toEqual([
      "mark-inactive 1",
      "delete-resource 1",
      "deploy 3",
    ]);
  });
});
