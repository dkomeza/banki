import { describe, expect, test } from "bun:test";
import {
  type Action,
  type Deployment,
  type DockerProject,
  type PangolinResource,
  type PlanInput,
  type PullRequest,
  imagesToCheck,
  plan,
  readEnoughDeployments,
} from "./planner";

// The planner decides everything the agent does, from what Docker, GitHub,
// GHCR and Pangolin say right now and the time. These tests build those
// observations by hand and check the actions it returns.

const SITE = 7;
const OTHER_SITE = 8;
const NOW = new Date("2026-10-20T12:00:00Z");
const EARLIER = new Date("2026-10-20T11:00:00Z");
const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const API_DIGEST = `sha256:${"1".repeat(64)}`;
const WEB_DIGEST = `sha256:${"2".repeat(64)}`;

const pr = (
  number: number,
  headSha: string,
  overrides: Partial<PullRequest> = {},
): PullRequest => ({
  number,
  headSha,
  headRepo: "dkomeza/banki",
  author: "dkomeza",
  ...overrides,
});

let nextDeploymentId = 100;
const deployment = (
  prNumber: number,
  sha: string,
  status: Deployment["status"],
  overrides: Partial<Deployment> = {},
): Deployment => ({
  id: nextDeploymentId++,
  pr: prNumber,
  sha,
  createdAt: EARLIER,
  status,
  ...overrides,
});

const project = (prNumber: number, overrides: Partial<DockerProject> = {}): DockerProject => ({
  pr: prNumber,
  sha: SHA_A,
  deployedAt: EARLIER,
  digests: { api: API_DIGEST, web: WEB_DIGEST },
  api: "running",
  web: "running",
  ...overrides,
});

/** What a leftover from a failed seed looks like: a volume and a network, no containers. */
const leftover = (prNumber: number): DockerProject =>
  project(prNumber, { api: "missing", web: "missing" });

const resource = (
  resourceId: number,
  fullDomain: string,
  siteIds: number[] = [SITE],
): PangolinResource => ({ resourceId, fullDomain, siteIds });

const ready = (prNumber: number, sha: string) => ({
  pr: prNumber,
  sha,
  digests: { api: API_DIGEST, web: WEB_DIGEST },
});

const input = (overrides: Partial<PlanInput> = {}): PlanInput => ({
  pullRequests: [],
  projects: [],
  deployments: [],
  images: [],
  resources: [],
  siteId: SITE,
  now: NOW,
  ...overrides,
});

const kinds = (actions: Action[]) => actions.map((action) => action.kind);

describe("a new target PR", () => {
  test("gets a Deployment for its head, queued", () => {
    const actions = plan(input({ pullRequests: [pr(5, SHA_A)] }));

    expect(actions).toEqual([{ kind: "create-deployment", pr: 5, sha: SHA_A }]);
  });
});

describe("targets", () => {
  test("a fork PR is ignored", () => {
    const actions = plan(input({ pullRequests: [pr(5, SHA_A, { headRepo: "someone/banki" })] }));

    expect(actions).toEqual([]);
  });

  test("a PR whose head repo is gone is ignored", () => {
    const actions = plan(input({ pullRequests: [pr(5, SHA_A, { headRepo: undefined })] }));

    expect(actions).toEqual([]);
  });

  test("a Dependabot PR is ignored, though its branch is in this repo", () => {
    const actions = plan(input({ pullRequests: [pr(5, SHA_A, { author: "dependabot[bot]" })] }));

    expect(actions).toEqual([]);
  });

  test("the head repo matches whatever its case", () => {
    const actions = plan(input({ pullRequests: [pr(5, SHA_A, { headRepo: "DKomeza/Banki" })] }));

    expect(kinds(actions)).toEqual(["create-deployment"]);
  });

  test("a fork PR's leftover project, resource and Deployments are torn down like a closed PR's", () => {
    const fork = pr(5, SHA_A, { headRepo: "someone/banki" });
    const live = deployment(5, SHA_A, "success");

    const actions = plan(
      input({
        pullRequests: [fork],
        projects: [project(5)],
        deployments: [live],
        resources: [resource(40, "pr-5.banki.dkomeza.com")],
      }),
    );

    expect(kinds(actions)).toEqual(["delete-resource", "teardown", "mark-inactive"]);
  });
});

describe("a closed PR", () => {
  test("loses its resource, its project with volumes and images, and its Deployments go inactive", () => {
    const older = deployment(5, SHA_A, "inactive");
    const live = deployment(5, SHA_B, "success");
    const running = project(5, { sha: SHA_B });

    const actions = plan(
      input({
        projects: [running],
        deployments: [older, live],
        resources: [resource(40, "pr-5.banki.dkomeza.com")],
      }),
    );

    expect(actions).toEqual([
      { kind: "delete-resource", pr: 5, resourceId: 40 },
      { kind: "teardown", project: running },
      { kind: "mark-inactive", pr: 5, deploymentId: live.id, reason: "closed" },
    ]);
  });

  test("a leftover project with only a volume and a network is torn down too", () => {
    const failed = deployment(5, SHA_A, "failure");

    const actions = plan(input({ projects: [leftover(5)], deployments: [failed] }));

    expect(actions).toEqual([
      { kind: "teardown", project: leftover(5) },
      { kind: "mark-inactive", pr: 5, deploymentId: failed.id, reason: "closed" },
    ]);
  });

  test("a Deployment still waiting for its images goes inactive", () => {
    const waiting = deployment(5, SHA_A, "queued");

    const actions = plan(input({ deployments: [waiting] }));

    expect(actions).toEqual([
      { kind: "mark-inactive", pr: 5, deploymentId: waiting.id, reason: "closed" },
    ]);
  });

  test("once everything is gone and inactive, there is nothing left to do", () => {
    const actions = plan(input({ deployments: [deployment(5, SHA_A, "inactive")] }));

    expect(actions).toEqual([]);
  });

  test("teardowns come before anything else, so a closed PR frees its Preview first", () => {
    const actions = plan(
      input({
        pullRequests: [pr(7, SHA_B)],
        projects: [project(5)],
        deployments: [deployment(5, SHA_A, "success")],
      }),
    );

    expect(kinds(actions)).toEqual(["teardown", "mark-inactive", "create-deployment"]);
  });
});

describe("a new SHA", () => {
  test("gets its own Deployment, while the old Preview keeps running and routed", () => {
    const live = deployment(5, SHA_A, "success");

    const actions = plan(
      input({
        pullRequests: [pr(5, SHA_B)],
        projects: [project(5, { sha: SHA_A })],
        deployments: [live],
        resources: [resource(40, "pr-5.banki.dkomeza.com")],
      }),
    );

    expect(actions).toEqual([{ kind: "create-deployment", pr: 5, sha: SHA_B }]);
  });

  test("whose images don't exist yet stays queued, and the old Preview is kept", () => {
    const live = deployment(5, SHA_A, "success");
    const waiting = deployment(5, SHA_B, "queued", { createdAt: NOW });
    const observed = {
      pullRequests: [pr(5, SHA_B)],
      projects: [project(5, { sha: SHA_A })],
      deployments: [live, waiting],
      resources: [resource(40, "pr-5.banki.dkomeza.com")],
    };

    expect(imagesToCheck(input(observed))).toEqual([{ pr: 5, sha: SHA_B }]);
    expect(plan(input({ ...observed, images: [] }))).toEqual([]);
  });

  test("whose images exist is deployed from scratch over the old Preview", () => {
    const live = deployment(5, SHA_A, "success");
    const waiting = deployment(5, SHA_B, "queued", { createdAt: NOW });
    const old = project(5, { sha: SHA_A });

    const actions = plan(
      input({
        pullRequests: [pr(5, SHA_B)],
        projects: [old],
        deployments: [live, waiting],
        images: [ready(5, SHA_B)],
        resources: [resource(40, "pr-5.banki.dkomeza.com")],
      }),
    );

    expect(actions).toEqual([
      {
        kind: "deploy",
        pr: 5,
        sha: SHA_B,
        deploymentId: waiting.id,
        digests: { api: API_DIGEST, web: WEB_DIGEST },
        previous: old,
        supersedes: [live.id],
        deployedAt: NOW,
      },
    ]);
  });

  test("images of another PR or another SHA don't count", () => {
    const waiting = deployment(5, SHA_B, "queued");

    const actions = plan(
      input({
        pullRequests: [pr(5, SHA_B)],
        deployments: [waiting],
        images: [ready(5, SHA_A), ready(6, SHA_B)],
      }),
    );

    expect(actions).toEqual([]);
  });

  test("a first deploy has no previous project and supersedes nothing", () => {
    const waiting = deployment(5, SHA_A, "queued");

    const actions = plan(
      input({ pullRequests: [pr(5, SHA_A)], deployments: [waiting], images: [ready(5, SHA_A)] }),
    );

    expect(actions).toEqual([
      expect.objectContaining({ kind: "deploy", previous: undefined, supersedes: [] }),
    ]);
  });

  test("a Deployment created without a status yet is marked queued while its images are missing", () => {
    const fresh = deployment(5, SHA_A, undefined);

    const actions = plan(input({ pullRequests: [pr(5, SHA_A)], deployments: [fresh] }));

    expect(actions).toEqual([{ kind: "mark-queued", pr: 5, sha: SHA_A, deploymentId: fresh.id }]);
  });

  test("a Deployment created without a status yet is deployed once its images exist", () => {
    const fresh = deployment(5, SHA_A, undefined);

    const actions = plan(
      input({ pullRequests: [pr(5, SHA_A)], deployments: [fresh], images: [ready(5, SHA_A)] }),
    );

    expect(kinds(actions)).toEqual(["deploy"]);
  });
});

describe("a deployed Preview", () => {
  test("running at its head with a success has nothing to do", () => {
    const observed = {
      pullRequests: [pr(5, SHA_A)],
      projects: [project(5, { sha: SHA_A })],
      deployments: [deployment(5, SHA_A, "success")],
      resources: [resource(40, "pr-5.banki.dkomeza.com")],
    };

    expect(imagesToCheck(input(observed))).toEqual([]);
    expect(plan(input(observed))).toEqual([]);
  });

  test("that failed is left alone until the next push, though its images exist", () => {
    const observed = {
      pullRequests: [pr(5, SHA_A)],
      projects: [project(5, { sha: SHA_A, api: "stopped", web: "stopped" })],
      deployments: [deployment(5, SHA_A, "failure")],
    };

    expect(imagesToCheck(input(observed))).toEqual([]);
    expect(plan(input({ ...observed, images: [ready(5, SHA_A)] }))).toEqual([]);
  });

  test("that failed is replaced by the next push", () => {
    const failed = deployment(5, SHA_A, "failure");
    const waiting = deployment(5, SHA_B, "queued", { createdAt: NOW });

    const actions = plan(
      input({
        pullRequests: [pr(5, SHA_B)],
        projects: [project(5, { sha: SHA_A, api: "stopped", web: "stopped" })],
        deployments: [failed, waiting],
        images: [ready(5, SHA_B)],
      }),
    );

    expect(actions).toEqual([
      expect.objectContaining({ kind: "deploy", sha: SHA_B, supersedes: [failed.id] }),
    ]);
  });

  test("interrupted by a restart before anything ran is deployed again from scratch", () => {
    const interrupted = deployment(5, SHA_A, "in_progress");

    const observed = {
      pullRequests: [pr(5, SHA_A)],
      projects: [leftover(5)],
      deployments: [interrupted],
    };

    expect(imagesToCheck(input(observed))).toEqual([{ pr: 5, sha: SHA_A }]);
    expect(plan(input({ ...observed, images: [ready(5, SHA_A)] }))).toEqual([
      expect.objectContaining({
        kind: "deploy",
        deploymentId: interrupted.id,
        previous: leftover(5),
      }),
    ]);
  });

  test("interrupted by a restart after it started, and running at its head, is confirmed, not taken down", () => {
    const older = deployment(5, SHA_B, "success");
    const interrupted = deployment(5, SHA_A, "in_progress", { createdAt: NOW });
    const running = project(5, { sha: SHA_A });

    const actions = plan(
      input({
        pullRequests: [pr(5, SHA_A)],
        projects: [running],
        deployments: [older, interrupted],
        images: [ready(5, SHA_A)],
      }),
    );

    expect(actions).toEqual([
      {
        kind: "confirm",
        pr: 5,
        sha: SHA_A,
        deploymentId: interrupted.id,
        project: running,
        supersedes: [older.id],
      },
    ]);
  });

  test("whose success couldn't be written is confirmed again, not redeployed, while it runs at its head", () => {
    const queued = deployment(5, SHA_A, "queued");

    const actions = plan(
      input({
        pullRequests: [pr(5, SHA_A)],
        projects: [project(5, { sha: SHA_A })],
        deployments: [queued],
        images: [ready(5, SHA_A)],
        resources: [resource(40, "pr-5.banki.dkomeza.com")],
      }),
    );

    expect(kinds(actions)).toEqual(["confirm"]);
  });

  test("is confirmed at its head even before its images are looked up again", () => {
    const interrupted = deployment(5, SHA_A, "in_progress");

    const actions = plan(
      input({
        pullRequests: [pr(5, SHA_A)],
        projects: [project(5, { sha: SHA_A })],
        deployments: [interrupted],
      }),
    );

    expect(kinds(actions)).toEqual(["confirm"]);
  });

  test("running at an older SHA is deployed over, not confirmed", () => {
    const waiting = deployment(5, SHA_B, "in_progress");

    const actions = plan(
      input({
        pullRequests: [pr(5, SHA_B)],
        projects: [project(5, { sha: SHA_A })],
        deployments: [waiting],
        images: [ready(5, SHA_B)],
      }),
    );

    expect(kinds(actions)).toEqual(["deploy"]);
  });

  test("stopped at its head is deployed again, not confirmed", () => {
    const interrupted = deployment(5, SHA_A, "in_progress");

    const actions = plan(
      input({
        pullRequests: [pr(5, SHA_A)],
        projects: [project(5, { sha: SHA_A, web: "stopped" })],
        deployments: [interrupted],
        images: [ready(5, SHA_A)],
      }),
    );

    expect(kinds(actions)).toEqual(["deploy"]);
  });

  test("of a reopened PR, whose Deployments went inactive on close, gets a new Deployment", () => {
    const closed = deployment(5, SHA_A, "inactive");

    const actions = plan(input({ pullRequests: [pr(5, SHA_A)], deployments: [closed] }));

    expect(actions).toEqual([{ kind: "create-deployment", pr: 5, sha: SHA_A }]);
  });
});

describe("older Deployments", () => {
  test("go inactive once the head's Deployment succeeds", () => {
    const first = deployment(5, SHA_A, "success");
    const skipped = deployment(5, SHA_B, "queued");
    const head = deployment(5, "c".repeat(40), "success", { createdAt: NOW });

    const actions = plan(
      input({
        pullRequests: [pr(5, head.sha)],
        projects: [project(5, { sha: head.sha })],
        deployments: [first, skipped, head],
        resources: [resource(40, "pr-5.banki.dkomeza.com")],
      }),
    );

    expect(actions).toEqual([
      { kind: "mark-inactive", pr: 5, deploymentId: first.id, reason: "superseded" },
      { kind: "mark-inactive", pr: 5, deploymentId: skipped.id, reason: "superseded" },
    ]);
  });

  test("go inactive once the head's Deployment fails, since its deploy took the old Preview down", () => {
    const first = deployment(5, SHA_A, "success");
    const head = deployment(5, SHA_B, "failure", { createdAt: NOW });

    const actions = plan(
      input({
        pullRequests: [pr(5, SHA_B)],
        projects: [project(5, { sha: SHA_B, api: "stopped", web: "stopped" })],
        deployments: [first, head],
      }),
    );

    expect(actions).toEqual([
      { kind: "mark-inactive", pr: 5, deploymentId: first.id, reason: "superseded" },
    ]);
  });

  test("stay as they are while the head's Deployment waits for its images", () => {
    const first = deployment(5, SHA_A, "success");
    const head = deployment(5, SHA_B, "queued", { createdAt: NOW });

    const actions = plan(
      input({
        pullRequests: [pr(5, SHA_B)],
        projects: [project(5, { sha: SHA_A })],
        deployments: [first, head],
        resources: [resource(40, "pr-5.banki.dkomeza.com")],
      }),
    );

    expect(actions).toEqual([]);
  });

  test("of another PR are never touched", () => {
    const other = deployment(7, SHA_A, "success");
    const head = deployment(5, SHA_B, "success", { createdAt: NOW });

    const actions = plan(
      input({
        pullRequests: [pr(5, SHA_B), pr(7, SHA_A)],
        projects: [project(5, { sha: SHA_B }), project(7, { sha: SHA_A })],
        deployments: [other, head],
        resources: [resource(40, "pr-5.banki.dkomeza.com"), resource(41, "pr-7.banki.dkomeza.com")],
      }),
    );

    expect(actions).toEqual([]);
  });

  test("the newest of several Deployments of the head commit is the head's", () => {
    const reopened = deployment(5, SHA_A, "inactive");
    const head = deployment(5, SHA_A, "queued", { createdAt: NOW });

    const actions = plan(
      input({
        pullRequests: [pr(5, SHA_A)],
        deployments: [head, reopened],
        images: [ready(5, SHA_A)],
      }),
    );

    expect(actions).toEqual([
      expect.objectContaining({ kind: "deploy", deploymentId: head.id, supersedes: [] }),
    ]);
  });
});

describe("Pangolin resources", () => {
  test("a running Preview with no resource gets one", () => {
    const actions = plan(
      input({
        pullRequests: [pr(5, SHA_A)],
        projects: [project(5, { sha: SHA_A })],
        deployments: [deployment(5, SHA_A, "success")],
      }),
    );

    expect(actions).toEqual([{ kind: "create-resource", pr: 5 }]);
  });

  test("a stopped Preview's resource is deleted, so its URL gives a 404", () => {
    const actions = plan(
      input({
        pullRequests: [pr(5, SHA_A)],
        projects: [project(5, { sha: SHA_A, api: "stopped", web: "stopped" })],
        deployments: [deployment(5, SHA_A, "failure")],
        resources: [resource(40, "pr-5.banki.dkomeza.com")],
      }),
    );

    expect(actions).toEqual([{ kind: "delete-resource", pr: 5, resourceId: 40 }]);
  });

  test("a target PR with no project has its stale resource deleted", () => {
    const actions = plan(
      input({
        pullRequests: [pr(5, SHA_A)],
        deployments: [deployment(5, SHA_A, "queued")],
        resources: [resource(40, "pr-5.banki.dkomeza.com")],
      }),
    );

    expect(actions).toEqual([{ kind: "delete-resource", pr: 5, resourceId: 40 }]);
  });

  test("resources the agent doesn't own are never touched", () => {
    const actions = plan(
      input({
        resources: [
          // On another site, though named like a Preview.
          resource(40, "pr-5.banki.dkomeza.com", [OTHER_SITE]),
          // On the Previews site, but not exactly a Preview's host name.
          resource(41, "banki.dkomeza.com"),
          resource(42, "pr-05.banki.dkomeza.com"),
          resource(43, "x.pr-5.banki.dkomeza.com"),
          resource(44, "pr-5.banki.dkomeza.com.evil.com"),
          resource(45, "pr-5-banki.dkomeza.com"),
          resource(46, "homelab.dkomeza.com"),
          // With no targets at all.
          resource(47, "pr-6.banki.dkomeza.com", []),
        ],
      }),
    );

    expect(actions).toEqual([]);
  });

  test("an owned resource on several sites, the Previews site among them, is still owned", () => {
    const actions = plan(
      input({ resources: [resource(40, "pr-5.banki.dkomeza.com", [OTHER_SITE, SITE])] }),
    );

    expect(actions).toEqual([{ kind: "delete-resource", pr: 5, resourceId: 40 }]);
  });
});

describe("a restart", () => {
  test("loses nothing: the same observations give the same plan", () => {
    const observed = input({
      pullRequests: [pr(5, SHA_B), pr(6, SHA_A)],
      projects: [project(5, { sha: SHA_A }), leftover(9)],
      deployments: [
        deployment(5, SHA_A, "success"),
        deployment(5, SHA_B, "in_progress"),
        deployment(9, SHA_A, "failure"),
      ],
      images: [ready(5, SHA_B)],
      resources: [resource(40, "pr-5.banki.dkomeza.com")],
    });

    expect(plan(structuredClone(observed))).toEqual(plan(observed));
    expect(kinds(plan(observed))).toEqual([
      "teardown",
      "mark-inactive",
      "create-deployment",
      "deploy",
    ]);
  });
});

test("a Preview about to be deployed gets its resource from the deploy, not before", () => {
  const actions = plan(
    input({
      pullRequests: [pr(5, SHA_B)],
      projects: [project(5, { sha: SHA_A })],
      deployments: [
        deployment(5, SHA_A, "success"),
        deployment(5, SHA_B, "queued", { createdAt: NOW }),
      ],
      images: [ready(5, SHA_B)],
    }),
  );

  expect(kinds(actions)).toEqual(["deploy"]);
});

describe("reading Deployments newest first", () => {
  test("stops once every target's head has one and the last page is all inactive", () => {
    const head = deployment(5, SHA_B, "success");
    const old = deployment(4, SHA_A, "inactive");

    expect(readEnoughDeployments([pr(5, SHA_B)], [head, old], [old])).toBe(true);
  });

  test("goes on while a target's head has none yet", () => {
    const old = deployment(4, SHA_A, "inactive");

    expect(readEnoughDeployments([pr(5, SHA_B)], [old], [old])).toBe(false);
  });

  test("goes on while the last page holds a Deployment that isn't inactive, which may need marking", () => {
    const head = deployment(5, SHA_B, "success");
    const stale = deployment(4, SHA_A, "queued");

    expect(readEnoughDeployments([pr(5, SHA_B)], [head, stale], [stale])).toBe(false);
  });

  test("counts only a Deployment of the head's own PR and commit", () => {
    const otherPr = deployment(6, SHA_B, "inactive");
    const otherSha = deployment(5, SHA_A, "inactive");

    expect(readEnoughDeployments([pr(5, SHA_B)], [otherPr, otherSha], [otherSha])).toBe(false);
  });

  test("needs no Deployment for a fork or Dependabot PR", () => {
    const old = deployment(4, SHA_A, "inactive");
    const pulls = [
      pr(5, SHA_B, { headRepo: "someone/banki" }),
      pr(6, SHA_B, { author: "dependabot[bot]" }),
    ];

    expect(readEnoughDeployments(pulls, [old], [old])).toBe(true);
  });
});
