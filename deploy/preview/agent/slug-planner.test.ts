import { describe, expect, test } from "bun:test";
import type { PangolinResource } from "./planner";
import { ownedResources } from "./planner";
import {
  type SlugAction,
  type SlugDeployment,
  type SlugPlanInput,
  type SlugProject,
  ownedSlugResources,
  planSlugs,
  readEnoughSlugDeployments,
  slugImagesToCheck,
  slugPayload,
} from "./slug-planner";

// The slug planner decides everything about the Slug Previews, from what
// Docker, GitHub, GHCR and Pangolin say right now and the time, the way
// planner.ts does for PR Previews. Its wanted set comes from the
// `slug-preview` Deployments alone: there are no pull requests.

const SITE = 7;
const OTHER_SITE = 8;
const HOUR_MS = 3_600_000;
const NOW = new Date("2026-10-20T12:00:00Z");
const EARLIER = new Date(NOW.getTime() - HOUR_MS);
const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const API_DIGEST = `sha256:${"1".repeat(64)}`;
const WEB_DIGEST = `sha256:${"2".repeat(64)}`;

let nextDeploymentId = 100;
const deployment = (
  slug: string,
  sha: string,
  status: SlugDeployment["status"],
  overrides: Partial<SlugDeployment> & { ttlHours?: number; ref?: string } = {},
): SlugDeployment => {
  const { ttlHours = 72, ref = "proto/variant", ...rest } = overrides;
  return {
    id: nextDeploymentId++,
    sha,
    createdAt: EARLIER,
    status,
    description: undefined,
    payload: { slug, ref, sha, ttlHours },
    ...rest,
  };
};

const project = (slug: string, overrides: Partial<SlugProject> = {}): SlugProject => ({
  slug,
  sha: SHA_A,
  // Deployed a minute after the Deployment was created, as the agent does.
  deployedAt: new Date(EARLIER.getTime() + 60_000),
  digests: { api: API_DIGEST, web: WEB_DIGEST },
  api: "running",
  web: "running",
  ...overrides,
});

const leftover = (slug: string) => project(slug, { api: "missing", web: "missing" });

/** A resource with targets on `siteIds`, named the way the agent names its own. */
const resource = (
  resourceId: number,
  fullDomain: string,
  siteIds: number[] = [SITE],
  overrides: Partial<PangolinResource> = {},
): PangolinResource => ({
  resourceId,
  fullDomain,
  name: `banki-slug-${fullDomain.split(".")[0] ?? ""}`,
  siteIds,
  hasTargets: siteIds.length > 0,
  ...overrides,
});

const host = (slug: string) => `${slug}.banki.dkomeza.com`;

const ready = (slug: string, sha: string) => ({
  slug,
  sha,
  digests: { api: API_DIGEST, web: WEB_DIGEST },
});

const input = (overrides: Partial<SlugPlanInput> = {}): SlugPlanInput => ({
  projects: [],
  deployments: [],
  images: [],
  resources: [],
  siteId: SITE,
  limits: { cap: 9 },
  now: NOW,
  ...overrides,
});

const kinds = (actions: SlugAction[]) => actions.map((action) => action.kind);

/** Only the evictions and the deploys: what the cap decides. */
const room = (actions: SlugAction[]) =>
  actions.filter(
    (action) =>
      (action.kind === "remove" && action.reason === "evicted") || action.kind === "deploy",
  );

const deployOf = (
  slug: string,
  sha: string,
  deploymentId: number,
  overrides: Partial<Extract<SlugAction, { kind: "deploy" }>> = {},
): SlugAction => ({
  pool: "slug",
  kind: "deploy",
  slug,
  sha,
  deploymentId,
  digests: { api: API_DIGEST, web: WEB_DIGEST },
  previous: undefined,
  supersedes: [],
  deployedAt: NOW,
  needs: [],
  ...overrides,
});

describe("a dispatched Slug Preview", () => {
  test("waits, queued, while its images don't exist", () => {
    const queued = deployment("blue", SHA_A, "queued");

    expect(planSlugs(input({ deployments: [queued] }))).toEqual([]);
  });

  test("a Deployment without a status yet is marked queued while its images are missing", () => {
    const fresh = deployment("blue", SHA_A, undefined);

    expect(planSlugs(input({ deployments: [fresh] }))).toEqual([
      { pool: "slug", kind: "mark-queued", slug: "blue", sha: SHA_A, deploymentId: fresh.id },
    ]);
  });

  test("is deployed once its images exist, tagged for its Slug and commit", () => {
    const queued = deployment("blue", SHA_A, "queued");

    const actions = planSlugs(input({ deployments: [queued], images: [ready("blue", SHA_A)] }));

    expect(actions).toEqual([deployOf("blue", SHA_A, queued.id)]);
  });

  test("images of another Slug or another commit don't count", () => {
    const queued = deployment("blue", SHA_A, "queued");

    const actions = planSlugs(
      input({ deployments: [queued], images: [ready("green", SHA_A), ready("blue", SHA_B)] }),
    );

    expect(actions).toEqual([]);
  });

  test("dispatched again at a new head, keeps the old Preview running and routed while it waits", () => {
    const live = deployment("blue", SHA_A, "success");
    const next = deployment("blue", SHA_B, "queued", { createdAt: NOW });

    const actions = planSlugs(
      input({
        projects: [project("blue")],
        deployments: [live, next],
        resources: [resource(40, host("blue"))],
      }),
    );

    expect(actions).toEqual([]);
  });

  test("dispatched again at a new head, is deployed from scratch over the old one once its images exist", () => {
    const live = deployment("blue", SHA_A, "success");
    const next = deployment("blue", SHA_B, "queued", { createdAt: NOW });
    const running = project("blue");

    const actions = planSlugs(
      input({
        projects: [running],
        deployments: [live, next],
        images: [ready("blue", SHA_B)],
        resources: [resource(40, host("blue"))],
      }),
    );

    expect(actions).toEqual([
      deployOf("blue", SHA_B, next.id, { previous: running, supersedes: [live.id] }),
    ]);
  });

  test("dispatched again at the same head, is deployed from scratch, not confirmed", () => {
    const live = deployment("blue", SHA_A, "success");
    const again = deployment("blue", SHA_A, "queued", { createdAt: NOW });
    const running = project("blue");

    const actions = planSlugs(
      input({
        projects: [running],
        deployments: [live, again],
        images: [ready("blue", SHA_A)],
        resources: [resource(40, host("blue"))],
      }),
    );

    expect(actions).toEqual([
      deployOf("blue", SHA_A, again.id, { previous: running, supersedes: [live.id] }),
    ]);
  });

  test("interrupted mid-deploy, and running at its commit since, is confirmed, not taken down", () => {
    const interrupted = deployment("blue", SHA_A, "in_progress");
    const running = project("blue");

    const actions = planSlugs(
      input({
        projects: [running],
        deployments: [interrupted],
        images: [ready("blue", SHA_A)],
      }),
    );

    expect(actions).toEqual([
      {
        pool: "slug",
        kind: "confirm",
        slug: "blue",
        sha: SHA_A,
        deploymentId: interrupted.id,
        project: running,
        supersedes: [],
      },
    ]);
  });

  test("interrupted mid-deploy with a service stopped is deployed again", () => {
    const interrupted = deployment("blue", SHA_A, "in_progress");
    const half = project("blue", { web: "stopped" });

    const actions = planSlugs(
      input({ projects: [half], deployments: [interrupted], images: [ready("blue", SHA_A)] }),
    );

    expect(actions).toEqual([deployOf("blue", SHA_A, interrupted.id, { previous: half })]);
  });
});

describe("a deployed Slug Preview", () => {
  test("running with a success has nothing to do", () => {
    const live = deployment("blue", SHA_A, "success");

    const actions = planSlugs(
      input({
        projects: [project("blue")],
        deployments: [live],
        images: [ready("blue", SHA_A)],
        resources: [resource(40, host("blue"))],
      }),
    );

    expect(actions).toEqual([]);
  });

  test("that failed is left stopped, and never retried though its images exist", () => {
    const failed = deployment("blue", SHA_A, "failure");

    const actions = planSlugs(
      input({
        projects: [project("blue", { api: "stopped", web: "stopped" })],
        deployments: [failed],
        images: [ready("blue", SHA_A)],
      }),
    );

    expect(actions).toEqual([]);
  });

  test("its older Deployments go inactive once the newest succeeds or fails", () => {
    for (const status of ["success", "failure"] as const) {
      const older = deployment("blue", SHA_A, "success");
      const newest = deployment("blue", SHA_B, status, { createdAt: NOW });

      const actions = planSlugs(
        input({
          projects: [project("blue", { sha: SHA_B })],
          deployments: [older, newest],
          resources: [resource(40, host("blue"))],
        }),
      );

      expect(actions).toContainEqual({
        pool: "slug",
        kind: "mark-inactive",
        slug: "blue",
        deploymentId: older.id,
        reason: "superseded",
      });
    }
  });

  test("its older Deployments stay as they are while the newest waits", () => {
    const older = deployment("blue", SHA_A, "success");
    const newest = deployment("blue", SHA_B, "queued", { createdAt: NOW });

    const actions = planSlugs(input({ projects: [project("blue")], deployments: [older, newest] }));

    expect(kinds(actions)).not.toContain("mark-inactive");
  });

  test("the newest of several Deployments of one Slug decides, the highest ID on a tie", () => {
    const first = deployment("blue", SHA_A, "success", { createdAt: EARLIER });
    const second = deployment("blue", SHA_B, "queued", { createdAt: EARLIER });

    const actions = planSlugs(
      input({ deployments: [second, first], images: [ready("blue", SHA_B)] }),
    );

    expect(actions).toEqual([deployOf("blue", SHA_B, second.id, { supersedes: [first.id] })]);
  });
});

describe("a failed newest Deployment", () => {
  test("whose build failed takes down the Preview an older one left running, and its resource", () => {
    const live = deployment("blue", SHA_A, "success");
    const failed = deployment("blue", SHA_B, "failure", {
      createdAt: NOW,
      description: "build failed",
    });
    const running = project("blue");

    const actions = planSlugs(
      input({
        projects: [running],
        deployments: [live, failed],
        resources: [resource(40, host("blue"))],
      }),
    );

    expect(actions).toEqual([
      { pool: "slug", kind: "delete-resource", slug: "blue", resourceId: 40 },
      { pool: "slug", kind: "teardown", project: running },
      {
        pool: "slug",
        kind: "mark-inactive",
        slug: "blue",
        deploymentId: live.id,
        reason: "superseded",
      },
    ]);
  });

  test("whose deploy failed leaves its own stopped project alone", () => {
    const failed = deployment("blue", SHA_B, "failure");

    const actions = planSlugs(
      input({
        projects: [project("blue", { sha: SHA_B, api: "stopped", web: "stopped" })],
        deployments: [failed],
      }),
    );

    expect(actions).toEqual([]);
  });

  test("still holds the Slug: a project of another commit doesn't count against the cap", () => {
    const queued = deployment("cyan", SHA_B, "queued");

    const actions = planSlugs(
      input({
        projects: [project("blue")],
        deployments: [deployment("blue", SHA_B, "failure"), queued],
        images: [ready("cyan", SHA_B)],
        limits: { cap: 1 },
      }),
    );

    expect(kinds(actions)).toEqual(["teardown", "deploy"]);
    expect(actions.at(-1)).toMatchObject({ slug: "cyan", needs: ["blue"] });
  });
});

describe("an inactive Slug Preview", () => {
  test("taken down: loses its resource and its project, with volumes and images", () => {
    const down = deployment("blue", SHA_A, "inactive", { description: "taken down" });
    const running = project("blue");

    const actions = planSlugs(
      input({
        projects: [running],
        deployments: [down],
        resources: [resource(40, host("blue"))],
      }),
    );

    expect(actions).toEqual([
      { pool: "slug", kind: "delete-resource", slug: "blue", resourceId: 40 },
      { pool: "slug", kind: "teardown", project: running },
    ]);
  });

  test("a leftover with only a volume and a network is torn down too", () => {
    const down = deployment("blue", SHA_A, "inactive");

    const actions = planSlugs(input({ projects: [leftover("blue")], deployments: [down] }));

    expect(actions).toEqual([{ pool: "slug", kind: "teardown", project: leftover("blue") }]);
  });

  test("doesn't come back by itself, though its images exist", () => {
    const down = deployment("blue", SHA_A, "inactive");

    const actions = planSlugs(input({ deployments: [down], images: [ready("blue", SHA_A)] }));

    expect(actions).toEqual([]);
  });

  test("its older Deployments that aren't inactive yet go inactive", () => {
    const older = deployment("blue", SHA_A, "success");
    const down = deployment("blue", SHA_B, "inactive", { createdAt: NOW });

    const actions = planSlugs(input({ deployments: [older, down] }));

    expect(actions).toEqual([
      {
        pool: "slug",
        kind: "mark-inactive",
        slug: "blue",
        deploymentId: older.id,
        reason: "superseded",
      },
    ]);
  });

  test("comes back when it is dispatched again", () => {
    const down = deployment("blue", SHA_A, "inactive");
    const again = deployment("blue", SHA_A, "queued", { createdAt: NOW });

    const actions = planSlugs(
      input({ deployments: [down, again], images: [ready("blue", SHA_A)] }),
    );

    expect(actions).toEqual([deployOf("blue", SHA_A, again.id)]);
  });

  test("a project with no Deployment at all is torn down, and its resource deleted", () => {
    const running = project("blue");

    const actions = planSlugs(
      input({ projects: [running], resources: [resource(40, host("blue"))] }),
    );

    expect(actions).toEqual([
      { pool: "slug", kind: "delete-resource", slug: "blue", resourceId: 40 },
      { pool: "slug", kind: "teardown", project: running },
    ]);
  });

  test("once everything is gone and inactive, there is nothing left to do", () => {
    expect(planSlugs(input({ deployments: [deployment("blue", SHA_A, "inactive")] }))).toEqual([]);
  });
});

/** `hours` after the Deployments of these tests were created. */
const at = (hours: number) => new Date(EARLIER.getTime() + hours * HOUR_MS);

describe("the time to live", () => {
  test("a Slug Preview just under its time to live stays", () => {
    const live = deployment("blue", SHA_A, "success");

    const actions = planSlugs(
      input({
        projects: [project("blue")],
        deployments: [live],
        resources: [resource(40, host("blue"))],
        now: new Date(at(72).getTime() - 1),
      }),
    );

    expect(actions).toEqual([]);
  });

  test("once it runs out, the Deployment is marked inactive first, then the resource and the project go", () => {
    const live = deployment("blue", SHA_A, "success");
    const running = project("blue");

    const actions = planSlugs(
      input({
        projects: [running],
        deployments: [live],
        resources: [resource(40, host("blue"))],
        now: at(72),
      }),
    );

    expect(actions).toEqual([
      {
        pool: "slug",
        kind: "remove",
        slug: "blue",
        reason: "expired",
        description: "expired after 72 h, dispatch again to rebuild",
        project: running,
        deploymentId: live.id,
        resourceIds: [40],
      },
    ]);
  });

  test("is the payload's ttlHours, clamped to 336", () => {
    const short = deployment("blue", SHA_A, "success", { ttlHours: 1 });
    const long = deployment("green", SHA_A, "success", { ttlHours: 5000 });

    const early = planSlugs(input({ deployments: [short, long], now: at(1) }));
    const late = planSlugs(input({ deployments: [long], now: at(336) }));

    expect(early).toEqual([
      expect.objectContaining({ kind: "remove", slug: "blue", deploymentId: short.id }),
    ]);
    expect(late).toEqual([
      expect.objectContaining({
        kind: "remove",
        slug: "green",
        description: "expired after 336 h, dispatch again to rebuild",
      }),
    ]);
  });

  test("runs out for a Deployment with no project too, and one still waiting for its images", () => {
    const failed = deployment("blue", SHA_A, "failure");
    const queued = deployment("green", SHA_A, "queued");

    const actions = planSlugs(
      input({ deployments: [failed, queued], images: [ready("green", SHA_A)], now: at(72) }),
    );

    expect(actions).toEqual([
      expect.objectContaining({
        kind: "remove",
        slug: "blue",
        project: undefined,
        resourceIds: [],
      }),
      expect.objectContaining({ kind: "remove", slug: "green", deploymentId: queued.id }),
    ]);
  });

  test("counts from the newest Deployment, so dispatching again starts it over", () => {
    const old = deployment("blue", SHA_A, "success", { createdAt: new Date(0) });
    const fresh = deployment("blue", SHA_A, "success", { createdAt: EARLIER });

    const actions = planSlugs(
      input({
        projects: [project("blue")],
        deployments: [old, fresh],
        resources: [resource(40, host("blue"))],
      }),
    );

    expect(kinds(actions)).toEqual(["mark-inactive"]);
  });

  test("an expired one, marked inactive, is then torn down like one taken down", () => {
    const expired = deployment("blue", SHA_A, "inactive", {
      description: "expired after 72 h, dispatch again to rebuild",
    });

    const actions = planSlugs(
      input({ projects: [project("blue")], deployments: [expired], now: at(100) }),
    );

    expect(kinds(actions)).toEqual(["teardown"]);
  });
});

describe("a bad payload", () => {
  const bad: [string, unknown][] = [
    ["no payload", null],
    ["a string", "blue"],
    ["an empty object", {}],
    ["an uppercase slug", { slug: "Blue", ref: "x", sha: SHA_A, ttlHours: 72 }],
    ["a reserved slug", { slug: "www", ref: "x", sha: SHA_A, ttlHours: 72 }],
    ["a PR Preview's name", { slug: "pr-5", ref: "x", sha: SHA_A, ttlHours: 72 }],
    ["a double hyphen", { slug: "a--b", ref: "x", sha: SHA_A, ttlHours: 72 }],
    ["a one-letter slug", { slug: "a", ref: "x", sha: SHA_A, ttlHours: 72 }],
    ["a slug of 41 characters", { slug: "a".repeat(41), ref: "x", sha: SHA_A, ttlHours: 72 }],
    ["no ref", { slug: "blue", sha: SHA_A, ttlHours: 72 }],
    ["an empty ref", { slug: "blue", ref: "", sha: SHA_A, ttlHours: 72 }],
    ["another commit than its own", { slug: "blue", ref: "x", sha: SHA_B, ttlHours: 72 }],
    ["no ttlHours", { slug: "blue", ref: "x", sha: SHA_A }],
    ["a ttlHours of 0", { slug: "blue", ref: "x", sha: SHA_A, ttlHours: 0 }],
    ["a fractional ttlHours", { slug: "blue", ref: "x", sha: SHA_A, ttlHours: 2.5 }],
    ["a ttlHours as a string", { slug: "blue", ref: "x", sha: SHA_A, ttlHours: "72" }],
  ];

  for (const [what, payload] of bad) {
    test(`with ${what} is marked a failure and never deployed`, () => {
      const broken = deployment("blue", SHA_A, "queued", { payload });

      const actions = planSlugs(input({ deployments: [broken], images: [ready("blue", SHA_A)] }));

      expect(slugPayload(broken)).toBeUndefined();
      expect(actions).toEqual([{ pool: "slug", kind: "mark-invalid", deploymentId: broken.id }]);
    });
  }

  test("already marked a failure, or inactive, is left alone", () => {
    const failed = deployment("blue", SHA_A, "failure", { payload: {} });
    const inactive = deployment("blue", SHA_A, "inactive", { payload: {} });

    expect(planSlugs(input({ deployments: [failed, inactive] }))).toEqual([]);
  });

  test("doesn't count as its Slug's newest: the Preview an older one made keeps running", () => {
    const live = deployment("blue", SHA_A, "success");
    const broken = deployment("blue", SHA_B, "queued", {
      createdAt: NOW,
      payload: { slug: "blue", ref: "x", sha: SHA_B, ttlHours: -1 },
    });

    const actions = planSlugs(
      input({
        projects: [project("blue")],
        deployments: [live, broken],
        images: [ready("blue", SHA_B)],
        resources: [resource(40, host("blue"))],
      }),
    );

    expect(actions).toEqual([{ pool: "slug", kind: "mark-invalid", deploymentId: broken.id }]);
  });

  test("a good payload is read, with its time to live clamped", () => {
    const good = deployment("blue", SHA_A, "queued", { ref: "proto/blue", ttlHours: 999 });

    expect(slugPayload(good)).toEqual({ slug: "blue", ref: "proto/blue", ttlHours: 336 });
  });
});

/** A running Slug Preview, deployed `minutesAgo`. */
const runningFor = (slug: string, minutesAgo: number) =>
  project(slug, { deployedAt: new Date(NOW.getTime() - minutesAgo * 60_000) });

const succeeded = (slug: string) => deployment(slug, SHA_A, "success");

describe("the cap on running Slug Previews", () => {
  test("a deploy that would bring them above the cap first evicts the oldest last deploy", () => {
    const oldest = runningFor("amber", 30);
    const newer = runningFor("cyan", 10);
    const [amber, cyan] = [succeeded("amber"), succeeded("cyan")];
    const queued = deployment("blue", SHA_B, "queued");

    const actions = planSlugs(
      input({
        projects: [newer, oldest],
        deployments: [amber, cyan, queued],
        images: [ready("blue", SHA_B)],
        resources: [resource(41, host("amber")), resource(42, host("cyan"))],
        limits: { cap: 2 },
      }),
    );

    expect(actions).toEqual([
      {
        pool: "slug",
        kind: "remove",
        slug: "amber",
        reason: "evicted",
        description: "evicted, dispatch again to rebuild",
        project: oldest,
        deploymentId: amber.id,
        resourceIds: [41],
      },
      // Its eviction leaves no spare room, so the deploy waits should it fail.
      deployOf("blue", SHA_B, queued.id, { needs: ["amber"] }),
    ]);
  });

  test("defaults to nine, and a deploy within it evicts nothing", () => {
    const slugs = ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"];
    const queued = deployment("blue", SHA_B, "queued");

    const actions = planSlugs(
      input({
        projects: slugs.map((slug, index) => runningFor(slug, index + 1)),
        deployments: [...slugs.map(succeeded), queued],
        images: [ready("blue", SHA_B)],
        resources: slugs.map((slug, index) => resource(40 + index, host(slug))),
      }),
    );

    expect(actions).toEqual([deployOf("blue", SHA_B, queued.id)]);
  });

  test("evicts as many as needed, oldest first, when the cap was lowered", () => {
    const projects = [runningFor("amber", 30), runningFor("cyan", 20), runningFor("dusk", 10)];
    const queued = deployment("blue", SHA_B, "queued");

    const actions = planSlugs(
      input({
        projects,
        deployments: [succeeded("amber"), succeeded("cyan"), succeeded("dusk"), queued],
        images: [ready("blue", SHA_B)],
        limits: { cap: 2 },
      }),
    );

    expect(room(actions).map((action) => ("slug" in action ? action.slug : ""))).toEqual([
      "amber",
      "cyan",
      "blue",
    ]);
  });

  test("a tie in the last deploy goes to the Slug first in the alphabet", () => {
    const queued = deployment("blue", SHA_B, "queued");

    const actions = planSlugs(
      input({
        projects: [runningFor("zinc", 10), runningFor("amber", 10)],
        deployments: [succeeded("zinc"), succeeded("amber"), queued],
        images: [ready("blue", SHA_B)],
        limits: { cap: 2 },
      }),
    );

    expect(room(actions)[0]).toMatchObject({ kind: "remove", slug: "amber" });
  });

  test("the Slug being deployed is never evicted, and its own Preview doesn't count", () => {
    const old = deployment("blue", SHA_A, "success");
    const next = deployment("blue", SHA_B, "queued", { createdAt: NOW });
    const own = runningFor("blue", 60);

    const actions = planSlugs(
      input({
        projects: [own, runningFor("cyan", 10)],
        deployments: [old, next, succeeded("cyan")],
        images: [ready("blue", SHA_B)],
        limits: { cap: 2 },
      }),
    );

    expect(room(actions)).toEqual([
      deployOf("blue", SHA_B, next.id, { previous: own, supersedes: [old.id] }),
    ]);
  });

  test("an eviction never marks a newest still waiting to deploy: it deploys anyway", () => {
    const interrupted = deployment("amber", SHA_A, "in_progress");
    const half = project("amber", {
      deployedAt: new Date(NOW.getTime() - 30 * 60_000),
      web: "restarting",
    });
    const queued = deployment("blue", SHA_B, "queued");

    const actions = planSlugs(
      input({
        projects: [half, runningFor("cyan", 10)],
        deployments: [interrupted, succeeded("cyan"), queued],
        images: [ready("blue", SHA_B)],
        limits: { cap: 2 },
      }),
    );

    expect(room(actions)[0]).toMatchObject({
      kind: "remove",
      slug: "amber",
      deploymentId: undefined,
    });
  });

  test("a failed Preview, a leftover volume and an inactive one being torn down don't count", () => {
    const queued = deployment("blue", SHA_B, "queued");

    const actions = planSlugs(
      input({
        projects: [
          project("amber", { api: "stopped", web: "stopped" }),
          leftover("cyan"),
          runningFor("dusk", 5),
          runningFor("echo", 5),
        ],
        deployments: [
          deployment("amber", SHA_A, "failure"),
          deployment("cyan", SHA_A, "failure"),
          deployment("dusk", SHA_A, "inactive"),
          succeeded("echo"),
          queued,
        ],
        images: [ready("blue", SHA_B)],
        limits: { cap: 2 },
      }),
    );

    expect(kinds(actions)).not.toContain("remove");
    // Filling the cap exactly, the deploy counts on the inactive one's teardown.
    expect(actions.at(-1)).toEqual(deployOf("blue", SHA_B, queued.id, { needs: ["dusk"] }));
  });
});

describe("Pangolin resources", () => {
  test("a running Slug Preview with no resource gets one", () => {
    const actions = planSlugs(
      input({ projects: [project("blue")], deployments: [deployment("blue", SHA_A, "success")] }),
    );

    expect(actions).toEqual([{ pool: "slug", kind: "create-resource", slug: "blue" }]);
  });

  test("a stopped Slug Preview's resource is deleted, so its URL gives a 404", () => {
    const actions = planSlugs(
      input({
        projects: [project("blue", { web: "stopped" })],
        deployments: [deployment("blue", SHA_A, "failure")],
        resources: [resource(40, host("blue"))],
      }),
    );

    expect(actions).toEqual([
      { pool: "slug", kind: "delete-resource", slug: "blue", resourceId: 40 },
    ]);
  });

  test("resources the slug pool doesn't own are never touched", () => {
    const actions = planSlugs(
      input({
        resources: [
          resource(1, host("blue"), [OTHER_SITE]),
          resource(2, `x.${host("blue")}`),
          resource(3, `${host("blue")}.evil`),
          resource(4, host("www")),
          resource(5, "pr-5.banki.dkomeza.com", [SITE], { name: "banki-pr-5" }),
          resource(6, host("Blue")),
          resource(7, "blue.example.com"),
          resource(8, "banki.dkomeza.com"),
        ],
      }),
    );

    expect(actions).toEqual([]);
  });

  test("an orphan it made, with no target, is deleted, and made again for a running Preview", () => {
    const actions = planSlugs(
      input({
        projects: [project("blue")],
        deployments: [deployment("blue", SHA_A, "success")],
        resources: [resource(40, host("blue"), [])],
      }),
    );

    expect(actions).toEqual([
      { pool: "slug", kind: "delete-resource", slug: "blue", resourceId: 40 },
      { pool: "slug", kind: "create-resource", slug: "blue" },
    ]);
  });

  test("a lookalike with the host but no targets and another name is never touched", () => {
    const actions = planSlugs(
      input({ resources: [resource(40, host("blue"), [], { name: "someone-elses" })] }),
    );

    expect(actions).toEqual([]);
  });

  test("owns exactly the slug hosts on the Previews site and its own orphans", () => {
    const owned = ownedSlugResources(
      [
        resource(1, host("blue")),
        resource(2, host("green"), [OTHER_SITE, SITE]),
        resource(3, host("cyan"), []),
        resource(4, host("dusk"), [OTHER_SITE]),
        resource(5, "pr-5.banki.dkomeza.com", [SITE], { name: "banki-pr-5" }),
      ],
      SITE,
    );

    expect(owned).toEqual([
      { slug: "blue", resourceId: 1, orphan: false },
      { slug: "green", resourceId: 2, orphan: false },
      { slug: "cyan", resourceId: 3, orphan: true },
    ]);
  });

  test("the PR pool never owns a slug resource, nor the slug pool a PR one", () => {
    const resources = [
      resource(1, host("blue")),
      resource(2, "pr-5.banki.dkomeza.com", [SITE], { name: "banki-pr-5" }),
    ];

    expect(ownedResources(resources, SITE).map((owned) => owned.resourceId)).toEqual([2]);
    expect(ownedSlugResources(resources, SITE).map((owned) => owned.resourceId)).toEqual([1]);
  });
});

describe("the images to look up", () => {
  test("are each wanted Slug's newest Deployment still waiting", () => {
    const observed = {
      ...input(),
      deployments: [
        deployment("blue", SHA_A, "queued"),
        deployment("cyan", SHA_A, "success"),
        deployment("dusk", SHA_A, "inactive"),
        deployment("echo", SHA_B, undefined),
        deployment("fawn", SHA_A, "queued", { payload: {} }),
        deployment("gold", SHA_A, "queued", { createdAt: new Date(0) }),
      ],
    };

    expect(slugImagesToCheck(observed)).toEqual([
      { slug: "blue", sha: SHA_A },
      { slug: "echo", sha: SHA_B },
    ]);
  });
});

describe("reading Deployments newest first", () => {
  test("stops once every project's Deployment is read and the last page is settled", () => {
    const made = deployment("blue", SHA_A, "success");
    const page = [
      deployment("blue", SHA_A, "inactive"),
      deployment("x", SHA_A, "failure", { payload: {} }),
    ];

    expect(readEnoughSlugDeployments([project("blue")], [made, ...page], page)).toBe(true);
  });

  test("goes on while a project's Deployment isn't read yet", () => {
    const page = [deployment("cyan", SHA_A, "inactive")];

    expect(readEnoughSlugDeployments([project("blue")], page, page)).toBe(false);
  });

  test("goes on while the last page holds a Deployment that may still need marking", () => {
    for (const status of ["success", "failure", "queued"] as const) {
      const page = [deployment("blue", SHA_A, status)];

      expect(readEnoughSlugDeployments([], page, page)).toBe(false);
    }
  });

  test("goes on while the last page holds a bad payload not yet marked a failure", () => {
    const page = [deployment("blue", SHA_A, "queued", { payload: {} })];

    expect(readEnoughSlugDeployments([], page, page)).toBe(false);
  });
});

describe("a restart", () => {
  test("loses nothing: the same observations give the same plan", () => {
    const observed = input({
      projects: [project("blue"), leftover("cyan")],
      deployments: [
        deployment("blue", SHA_A, "success"),
        deployment("blue", SHA_B, "queued", { createdAt: NOW }),
        deployment("cyan", SHA_A, "inactive"),
      ],
      images: [ready("blue", SHA_B)],
      resources: [resource(40, host("blue"))],
    });

    expect(planSlugs(observed)).toEqual(planSlugs(structuredClone(observed)));
  });
});
