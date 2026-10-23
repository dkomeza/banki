import { describe, expect, spyOn, test } from "bun:test";
import { type AnyAction, orderPlans, runActions } from "./act";
import type { Action, DockerProject } from "./planner";
import type { SlugAction, SlugProject } from "./slug-planner";

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

const slugProject = (slug: string): SlugProject => ({
  slug,
  sha: "a".repeat(40),
  deployedAt: new Date("2026-10-20T11:00:00Z"),
  digests: undefined,
  api: "running",
  web: "running",
});

/** A Slug Preview's eviction. */
const slugRemoval = (slug: string): SlugAction => ({
  pool: "slug",
  kind: "remove",
  slug,
  reason: "evicted",
  description: "evicted, dispatch again to rebuild",
  project: slugProject(slug),
  deploymentId: 900,
  resourceIds: [],
});

/** A deploy of Slug `<slug>` that counts on the Slug Previews of `needs` being gone first. */
const slugDeploy = (slug: string, needs: string[] = []): SlugAction => ({
  pool: "slug",
  kind: "deploy",
  slug,
  sha: "b".repeat(40),
  deploymentId: 901,
  digests: { api: "sha256:1", web: "sha256:2" },
  previous: undefined,
  supersedes: [],
  deployedAt: new Date("2026-10-20T12:00:00Z"),
  needs,
});

const label = (action: AnyAction) => {
  if (action.kind === "mark-invalid") return `${action.kind} ${action.deploymentId}`;
  if (action.kind === "teardown") {
    return `${action.kind} ${"slug" in action.project ? action.project.slug : action.project.pr}`;
  }
  return `${action.kind} ${"slug" in action ? action.slug : action.pr}`;
};

/** Runs `actions`, failing those whose label is in `failing`; the labels of those that ran. */
async function ran(actions: AnyAction[], failing: string[] = []): Promise<string[]> {
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

describe("running both pools' plans", () => {
  test("skips a Slug Preview's deploy when the slug eviction it needs failed", async () => {
    const actions = [slugRemoval("amber"), slugDeploy("blue", ["amber"])];

    expect(await ran(actions, ["remove amber"])).toEqual(["remove amber"]);
  });

  test("a PR Preview's failed cleanup never holds back a Slug Preview's deploy, nor the reverse", async () => {
    const actions = [removal(1, "evicted"), slugRemoval("amber"), slugDeploy("blue")];

    expect(await ran(actions, ["remove 1"])).toEqual(["remove 1", "remove amber", "deploy blue"]);
    expect(await ran([slugRemoval("amber"), deploy(3, [1])], ["remove amber"])).toEqual([
      "remove amber",
      "deploy 3",
    ]);
  });
});

describe("ordering the two pools", () => {
  const pr = {
    upkeep: [{ kind: "create-resource", pr: 6 } as const],
    deploys: [removal(1, "evicted"), deploy(3, [1])],
  };
  const slug = {
    upkeep: [{ pool: "slug", kind: "create-resource", slug: "cyan" } as const],
    deploys: [slugRemoval("amber"), slugDeploy("blue", ["amber"])],
  };

  test("runs both pools' upkeep before any deploy, then the deploys of the pool whose turn it is", () => {
    const ordered = orderPlans(pr, slug, "slug");

    expect(ordered.actions.map(label)).toEqual([
      "create-resource 6",
      "create-resource cyan",
      "remove amber",
      "deploy blue",
      "remove 1",
      "deploy 3",
    ]);
  });

  test("passes the turn to the other pool when both had a deploy waiting, so neither starves", async () => {
    const first = orderPlans(pr, slug, "pr");
    const second = orderPlans(pr, slug, first.turn);

    expect(first.turn).toBe("slug");
    expect(second.turn).toBe("pr");
    expect(await ran(first.actions)).toContain("deploy 3");
    expect(await ran(first.actions)).not.toContain("deploy blue");
    expect(await ran(second.actions)).toContain("deploy blue");
    expect(await ran(second.actions)).not.toContain("deploy 3");
  });

  test("keeps the turn while only one pool has a deploy waiting", () => {
    const idle = { upkeep: [], deploys: [] };

    expect(orderPlans(pr, idle, "slug")).toMatchObject({ turn: "slug" });
    expect(orderPlans(idle, slug, "pr").actions.map(label)).toEqual([
      "create-resource cyan",
      "remove amber",
      "deploy blue",
    ]);
  });
});
