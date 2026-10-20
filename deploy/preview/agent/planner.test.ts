import { describe, expect, test } from "bun:test";
import {
  type Action,
  type Deployment,
  type DockerProject,
  type PangolinResource,
  type PlanInput,
  type PullRequest,
  imagesToCheck,
  isFullReadLoop,
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
  description: undefined,
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

/** A resource with targets on `siteIds`, named the way the agent names its own. */
const resource = (
  resourceId: number,
  fullDomain: string,
  siteIds: number[] = [SITE],
  overrides: Partial<PangolinResource> = {},
): PangolinResource => ({
  resourceId,
  fullDomain,
  name: fullDomain.replace(/^pr-([0-9]+)\..*$/, "banki-pr-$1"),
  siteIds,
  hasTargets: siteIds.length > 0,
  ...overrides,
});

/** A resource the agent created but never gave its target: it was cut short. */
const orphan = (resourceId: number, prNumber: number) =>
  resource(resourceId, `pr-${prNumber}.banki.dkomeza.com`, []);

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
  limits: { cap: 5, idleDays: 7 },
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
        needs: [],
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
          // With no targets at all, but not named the way the agent names its own.
          resource(47, "pr-6.banki.dkomeza.com", [], { name: "someone-else" }),
          // Named like the agent's, but its targets are on another site.
          resource(48, "pr-7.banki.dkomeza.com", [OTHER_SITE], { name: "banki-pr-7" }),
        ],
      }),
    );

    expect(actions).toEqual([]);
  });

  test("an orphan the agent made, with no target, is deleted and made again for a running Preview", () => {
    const actions = plan(
      input({
        pullRequests: [pr(5, SHA_A)],
        projects: [project(5, { sha: SHA_A })],
        deployments: [deployment(5, SHA_A, "success")],
        resources: [orphan(40, 5)],
      }),
    );

    expect(actions).toEqual([
      { kind: "delete-resource", pr: 5, resourceId: 40 },
      { kind: "create-resource", pr: 5 },
    ]);
  });

  test("an orphan of a closed PR is deleted", () => {
    const actions = plan(input({ resources: [orphan(40, 5)] }));

    expect(actions).toEqual([{ kind: "delete-resource", pr: 5, resourceId: 40 }]);
  });

  test("an orphan of a PR about to be deployed is deleted, and the deploy makes the resource", () => {
    const actions = plan(
      input({
        pullRequests: [pr(5, SHA_A)],
        deployments: [deployment(5, SHA_A, "queued")],
        images: [ready(5, SHA_A)],
        resources: [orphan(40, 5)],
      }),
    );

    expect(kinds(actions)).toEqual(["delete-resource", "deploy"]);
  });

  test("a lookalike with the Preview's host but no targets and another name is never touched", () => {
    const lookalike = resource(40, "pr-5.banki.dkomeza.com", [], { name: "pr-5" });

    const actions = plan(
      input({
        pullRequests: [pr(5, SHA_A)],
        projects: [project(5, { sha: SHA_A })],
        deployments: [deployment(5, SHA_A, "success")],
        resources: [lookalike],
      }),
    );

    expect(actions).toEqual([{ kind: "create-resource", pr: 5 }]);
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

    expect(readEnoughDeployments([pr(5, SHA_B)], [], [head, old], [old])).toBe(true);
  });

  test("goes on while a target's head has none yet", () => {
    const old = deployment(4, SHA_A, "inactive");

    expect(readEnoughDeployments([pr(5, SHA_B)], [], [old], [old])).toBe(false);
  });

  test("goes on while the last page holds a Deployment that isn't inactive, which may need marking", () => {
    const head = deployment(5, SHA_B, "success");
    const stale = deployment(4, SHA_A, "queued");

    expect(readEnoughDeployments([pr(5, SHA_B)], [], [head, stale], [stale])).toBe(false);
  });

  test("counts only a Deployment of the head's own PR and commit", () => {
    const otherPr = deployment(6, SHA_B, "inactive");
    const otherSha = deployment(5, SHA_A, "inactive");

    expect(readEnoughDeployments([pr(5, SHA_B)], [], [otherPr, otherSha], [otherSha])).toBe(false);
  });

  test("needs no Deployment for a fork or Dependabot PR", () => {
    const old = deployment(4, SHA_A, "inactive");
    const pulls = [
      pr(5, SHA_B, { headRepo: "someone/banki" }),
      pr(6, SHA_B, { author: "dependabot[bot]" }),
    ];

    expect(readEnoughDeployments(pulls, [], [old], [old])).toBe(true);
  });

  test("goes on while a target's Preview, from an older push, has no Deployment read yet", () => {
    // PR 5's newer head waits for images it may never get, and its Preview of
    // SHA_A, whose success a removal must mark, is on an older page.
    const head = deployment(5, SHA_B, "queued");
    const old = deployment(4, SHA_A, "inactive");
    const running = project(5, { sha: SHA_A });

    expect(readEnoughDeployments([pr(5, SHA_B)], [running], [head, old], [old])).toBe(false);
  });

  test("stops once the Deployment that made a target's Preview is read too", () => {
    const head = deployment(5, SHA_B, "queued");
    const made = deployment(5, SHA_A, "inactive");
    const running = project(5, { sha: SHA_A });

    expect(readEnoughDeployments([pr(5, SHA_B)], [running], [head, made], [made])).toBe(true);
  });

  test("needs no Deployment for a closed PR's Preview, or one without a SHA label", () => {
    const head = deployment(5, SHA_B, "success");
    const old = deployment(4, SHA_A, "inactive");
    const projects = [project(7, { sha: SHA_A }), project(5, { sha: undefined })];

    expect(readEnoughDeployments([pr(5, SHA_B)], projects, [head, old], [old])).toBe(true);
  });
});

describe("full reads of the Deployments", () => {
  test("happen on the agent's first loop and every 20th after it, about every 10 minutes", () => {
    const full = Array.from({ length: 61 }, (_, loop) => loop).filter(isFullReadLoop);

    expect(full).toEqual([0, 20, 40, 60]);
  });
});

const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000);

/** PR `<n>`'s Preview, running at SHA_A since `deployedAt`, with its success and its resource. */
const live = (prNumber: number, deployedAt: Date) => ({
  pull: pr(prNumber, SHA_A),
  project: project(prNumber, { deployedAt }),
  deployment: deployment(prNumber, SHA_A, "success"),
  resource: resource(prNumber * 10, `pr-${prNumber}.banki.dkomeza.com`),
});

type Live = ReturnType<typeof live>;

/** PR `<n>`'s new push of SHA_B, queued with its images ready. */
const pushed = (prNumber: number) => ({
  pull: pr(prNumber, SHA_B),
  deployment: deployment(prNumber, SHA_B, "queued", { createdAt: NOW }),
  images: ready(prNumber, SHA_B),
});

/** The observations of these running Previews and these pushes waiting to deploy. */
const observing = (running: Live[], pushes: ReturnType<typeof pushed>[], cap: number) =>
  input({
    pullRequests: [
      ...pushes.map((push) => push.pull),
      ...running
        .filter((one) => !pushes.some((push) => push.pull.number === one.pull.number))
        .map((one) => one.pull),
    ],
    projects: running.map((one) => one.project),
    deployments: [
      ...running.map((one) => one.deployment),
      ...pushes.map((push) => push.deployment),
    ],
    images: pushes.map((push) => push.images),
    resources: running.map((one) => one.resource),
    limits: { cap, idleDays: 7 },
  });

const eviction = (one: Live): Action => ({
  kind: "remove",
  pr: one.pull.number,
  reason: "evicted",
  description: "evicted, push to rebuild",
  project: one.project,
  deploymentId: one.deployment.id,
  resourceIds: [one.resource.resourceId],
});

describe("the cap on running Previews", () => {
  test("a deploy that would bring them above the cap first evicts the one with the oldest last deploy", () => {
    const oldest = live(1, hoursAgo(3));
    const newer = live(2, hoursAgo(2));

    const actions = plan(observing([newer, oldest], [pushed(3)], 2));

    expect(actions).toEqual([
      eviction(oldest),
      expect.objectContaining({ kind: "deploy", pr: 3, sha: SHA_B }),
    ]);
  });

  test("a deploy that keeps them within the cap evicts nothing", () => {
    const actions = plan(observing([live(1, hoursAgo(3))], [pushed(3)], 2));

    expect(kinds(actions)).toEqual(["deploy"]);
  });

  test("evicts as many as needed, oldest first, when the cap was lowered", () => {
    const first = live(1, hoursAgo(5));
    const second = live(2, hoursAgo(4));
    const third = live(3, hoursAgo(3));
    const fourth = live(4, hoursAgo(2));

    const actions = plan(observing([fourth, third, first, second], [pushed(9)], 2));

    expect(actions).toEqual([
      eviction(first),
      eviction(second),
      eviction(third),
      expect.objectContaining({ kind: "deploy", pr: 9 }),
    ]);
  });

  test("a tie in the last deploy goes to the lower PR", () => {
    const higher = live(8, hoursAgo(3));
    const lower = live(4, hoursAgo(3));

    const actions = plan(observing([higher, lower, live(6, hoursAgo(1))], [pushed(9)], 3));

    expect(actions).toEqual([eviction(lower), expect.objectContaining({ kind: "deploy", pr: 9 })]);
  });

  test("a Preview without a deploy time counts as the oldest", () => {
    const unlabelled = live(5, hoursAgo(1));
    unlabelled.project = project(5, { deployedAt: undefined });

    const actions = plan(observing([live(1, hoursAgo(3)), unlabelled], [pushed(9)], 2));

    expect(actions).toEqual([
      eviction(unlabelled),
      expect.objectContaining({ kind: "deploy", pr: 9 }),
    ]);
  });

  test("the PR being deployed is never evicted, and its own Preview doesn't count, since the deploy replaces it", () => {
    // PR 1's old push is the oldest Preview, and at a cap of 2 the deploy fits.
    const own = live(1, hoursAgo(5));
    const other = live(2, hoursAgo(1));

    const actions = plan(observing([own, other], [pushed(1)], 2));

    expect(actions).toEqual([
      expect.objectContaining({ kind: "deploy", pr: 1, previous: own.project }),
    ]);
  });

  test("at a cap of 1, a push replaces the PR's own Preview and evicts the other", () => {
    const own = live(1, hoursAgo(1));
    const other = live(2, hoursAgo(5));

    const actions = plan(observing([own, other], [pushed(1)], 1));

    expect(actions).toEqual([eviction(other), expect.objectContaining({ kind: "deploy", pr: 1 })]);
  });

  test("a confirm isn't a new admission and evicts nothing", () => {
    const interrupted = deployment(3, SHA_A, "in_progress");

    const actions = plan(
      input({
        pullRequests: [pr(1, SHA_A), pr(2, SHA_A), pr(3, SHA_A)],
        projects: [
          project(1, { deployedAt: hoursAgo(3) }),
          project(2, { deployedAt: hoursAgo(2) }),
          project(3, { deployedAt: NOW }),
        ],
        deployments: [
          deployment(1, SHA_A, "success"),
          deployment(2, SHA_A, "success"),
          interrupted,
        ],
        resources: [resource(10, "pr-1.banki.dkomeza.com"), resource(20, "pr-2.banki.dkomeza.com")],
        limits: { cap: 2, idleDays: 7 },
      }),
    );

    expect(kinds(actions)).toEqual(["confirm"]);
  });

  test("a failed Preview, one stopped by hand and a leftover volume don't count", () => {
    const running = live(1, hoursAgo(1));
    const failed = live(2, hoursAgo(3));
    failed.project = project(2, { deployedAt: hoursAgo(3), api: "stopped", web: "stopped" });
    failed.deployment = deployment(2, SHA_A, "failure");
    const stoppedByHand = live(3, hoursAgo(4));
    stoppedByHand.project = project(3, { deployedAt: hoursAgo(4), api: "stopped", web: "stopped" });
    const volumeOnly = live(4, hoursAgo(5));
    volumeOnly.project = { ...leftover(4), deployedAt: hoursAgo(5) };
    volumeOnly.deployment = deployment(4, SHA_A, "failure");
    const observed = observing([running, failed, stoppedByHand, volumeOnly], [pushed(9)], 2);

    const actions = plan({ ...observed, resources: [running.resource] });

    expect(kinds(actions)).toEqual(["deploy"]);
  });

  for (const state of ["restarting", "paused"] as const) {
    test(`a ${state} Preview counts, as it holds its place`, () => {
      const holding = live(1, hoursAgo(3));
      holding.project = project(1, { deployedAt: hoursAgo(3), api: state, web: state });

      const actions = plan(observing([holding, live(2, hoursAgo(1))], [pushed(9)], 2));

      expect(actions).toEqual([
        eviction(holding),
        expect.objectContaining({ kind: "deploy", pr: 9, needs: [1] }),
      ]);
    });

    test(`a ${state} Preview is neither confirmed nor routed`, () => {
      const interrupted = deployment(5, SHA_A, "in_progress");
      const observed = {
        pullRequests: [pr(5, SHA_A)],
        projects: [project(5, { sha: SHA_A, api: state, web: state })],
        deployments: [interrupted],
        resources: [resource(50, "pr-5.banki.dkomeza.com")],
      };

      // Redeployed from scratch, and its resource goes, so its URL gives a 404.
      expect(kinds(plan(input(observed)))).toEqual(["delete-resource"]);
      expect(kinds(plan(input({ ...observed, images: [ready(5, SHA_A)] })))).toEqual([
        "delete-resource",
        "deploy",
      ]);
    });
  }

  test("a Preview with only one of its services running still counts", () => {
    const halfUp = live(1, hoursAgo(3));
    halfUp.project = project(1, { deployedAt: hoursAgo(3), web: "stopped" });

    const actions = plan(observing([halfUp, live(2, hoursAgo(1))], [pushed(9)], 2));

    // Its resource goes with it, once.
    expect(actions).toEqual([eviction(halfUp), expect.objectContaining({ kind: "deploy", pr: 9 })]);
  });

  test("a closed PR's Preview doesn't count: its teardown comes first", () => {
    const closed = live(1, hoursAgo(1));
    const observed = observing([closed, live(2, hoursAgo(3))], [pushed(9)], 2);

    const actions = plan({ ...observed, pullRequests: observed.pullRequests.slice(0, 2) });

    expect(kinds(actions)).toEqual(["delete-resource", "teardown", "mark-inactive", "deploy"]);
  });

  test("a PR with its own deploy in the plan isn't evicted while another can be", () => {
    // PR 1 is the oldest, but its new push deploys in this plan too.
    const oldest = live(1, hoursAgo(3));
    const newer = live(2, hoursAgo(2));

    const actions = plan(observing([oldest, newer], [pushed(3), pushed(1)], 2));

    expect(actions).toEqual([
      eviction(newer),
      expect.objectContaining({ kind: "deploy", pr: 3 }),
      expect.objectContaining({ kind: "deploy", pr: 1, previous: oldest.project }),
    ]);
  });

  test("a PR redeploying its head, with only api left running, isn't evicted while another can be", () => {
    const halfUp = project(1, { sha: SHA_A, deployedAt: hoursAgo(3), web: "stopped" });
    const head = deployment(1, SHA_A, "in_progress");
    const newer = live(2, hoursAgo(2));
    const observed = observing([newer], [pushed(3)], 2);

    const actions = plan({
      ...observed,
      pullRequests: [...observed.pullRequests, pr(1, SHA_A)],
      projects: [...observed.projects, halfUp],
      deployments: [...observed.deployments, head],
      images: [...observed.images, ready(1, SHA_A)],
    });

    expect(actions).toEqual([
      eviction(newer),
      expect.objectContaining({ kind: "deploy", pr: 3 }),
      expect.objectContaining({ kind: "deploy", pr: 1, deploymentId: head.id }),
    ]);
  });

  test("when only PRs deploying in the plan can make room, one is evicted, so no deploy waits forever", () => {
    // At a cap of 1, each of the two would otherwise wait for the other.
    const first = live(1, hoursAgo(3));
    const second = live(2, hoursAgo(2));

    const actions = plan(observing([first, second], [pushed(1), pushed(2)], 1));

    expect(actions.slice(0, 2)).toEqual([
      eviction(second),
      expect.objectContaining({ kind: "deploy", pr: 1 }),
    ]);
  });

  test("an eviction never marks a head still waiting to deploy: that head deploys anyway", () => {
    const halfUp = project(2, { sha: SHA_A, deployedAt: hoursAgo(2), web: "stopped" });
    const head = deployment(2, SHA_A, "in_progress");
    const observed = observing([], [pushed(1)], 1);

    const actions = plan({
      ...observed,
      pullRequests: [...observed.pullRequests, pr(2, SHA_A)],
      projects: [halfUp],
      deployments: [...observed.deployments, head],
      images: [...observed.images, ready(2, SHA_A)],
    });

    expect(actions.slice(0, 2)).toEqual([
      {
        kind: "remove",
        pr: 2,
        reason: "evicted",
        description: "evicted, push to rebuild",
        project: halfUp,
        deploymentId: undefined,
        resourceIds: [],
      },
      expect.objectContaining({ kind: "deploy", pr: 1 }),
    ]);
  });

  test("several deploys in one plan each make room, counting the ones before as the newest", () => {
    const oldest = live(1, hoursAgo(3));
    const newer = live(2, hoursAgo(2));

    const actions = plan(observing([oldest, newer], [pushed(8), pushed(9)], 2));

    expect(actions).toEqual([
      eviction(oldest),
      expect.objectContaining({ kind: "deploy", pr: 8 }),
      eviction(newer),
      expect.objectContaining({ kind: "deploy", pr: 9 }),
    ]);
  });
});

const DAY_MS = 86_400_000;
const SEVEN_DAYS_AGO = new Date(NOW.getTime() - 7 * DAY_MS);

const idleRemoval = (
  one: { project: DockerProject; deployment: Deployment },
  resourceIds: number[],
  description = "idle for 7 days, push to rebuild",
): Action => ({
  kind: "remove",
  pr: one.project.pr,
  reason: "idle",
  description,
  project: one.project,
  deploymentId: one.deployment.id,
  resourceIds,
});

describe("idle Previews", () => {
  test("a Preview deployed just under the idle limit ago stays", () => {
    const one = live(5, new Date(SEVEN_DAYS_AGO.getTime() + 1));

    expect(plan(observing([one], [], 5))).toEqual([]);
  });

  test("a Preview deployed exactly the idle limit ago is removed, its Deployment marked first", () => {
    const one = live(5, SEVEN_DAYS_AGO);

    expect(plan(observing([one], [], 5))).toEqual([idleRemoval(one, [50])]);
  });

  test("a failed Preview is removed too, its failure replaced", () => {
    const failed = {
      project: project(5, { deployedAt: SEVEN_DAYS_AGO, api: "stopped", web: "stopped" }),
      deployment: deployment(5, SHA_A, "failure"),
    };

    const actions = plan(
      input({
        pullRequests: [pr(5, SHA_A)],
        projects: [failed.project],
        deployments: [failed.deployment],
      }),
    );

    expect(actions).toEqual([idleRemoval(failed, [])]);
  });

  test("a leftover with only a volume is removed too", () => {
    const volumeOnly = {
      project: { ...leftover(5), deployedAt: SEVEN_DAYS_AGO },
      deployment: deployment(5, SHA_A, "failure"),
    };

    const actions = plan(
      input({
        pullRequests: [pr(5, SHA_A)],
        projects: [volumeOnly.project],
        deployments: [volumeOnly.deployment],
      }),
    );

    expect(actions).toEqual([idleRemoval(volumeOnly, [])]);
  });

  test("a Preview without a deploy time never goes idle: only the label counts", () => {
    const one = live(5, SEVEN_DAYS_AGO);
    one.project = project(5, { deployedAt: undefined });

    expect(plan(observing([one], [], 5))).toEqual([]);
  });

  test("the limit takes decimals, and the description says it", () => {
    // 0.01 days is 864 s.
    const one = live(5, new Date(NOW.getTime() - 864_000));
    const actions = plan({ ...observing([one], [], 5), limits: { cap: 5, idleDays: 0.01 } });

    expect(actions).toEqual([idleRemoval(one, [50], "idle for 0.01 days, push to rebuild")]);
  });

  test("a limit of one day reads as one day", () => {
    const one = live(5, new Date(NOW.getTime() - DAY_MS));
    const actions = plan({ ...observing([one], [], 5), limits: { cap: 5, idleDays: 1 } });

    expect(actions).toEqual([idleRemoval(one, [50], "idle for 1 day, push to rebuild")]);
  });

  test("a newer push still queued for its images is left alone", () => {
    const one = live(5, SEVEN_DAYS_AGO);
    const waiting = deployment(5, SHA_B, "queued", { createdAt: NOW });
    const observed = {
      ...observing([one], [], 5),
      pullRequests: [pr(5, SHA_B)],
      deployments: [one.deployment, waiting],
    };

    expect(plan(observed)).toEqual([idleRemoval(one, [50])]);
    expect(imagesToCheck(observed)).toEqual([{ pr: 5, sha: SHA_B }]);
  });

  test("a newer push whose images arrive deploys, after the idle Preview goes", () => {
    const one = live(5, SEVEN_DAYS_AGO);
    const waiting = deployment(5, SHA_B, "queued", { createdAt: NOW });

    const actions = plan({
      ...observing([one], [], 5),
      pullRequests: [pr(5, SHA_B)],
      deployments: [one.deployment, waiting],
      images: [ready(5, SHA_B)],
    });

    expect(actions).toEqual([
      idleRemoval(one, [50]),
      expect.objectContaining({ kind: "deploy", pr: 5, sha: SHA_B, deploymentId: waiting.id }),
    ]);
  });

  test("a head interrupted mid-deploy whose Preview went idle waits for the next push, not confirmed", () => {
    const interrupted = {
      project: project(5, { deployedAt: SEVEN_DAYS_AGO }),
      deployment: deployment(5, SHA_A, "in_progress"),
    };

    const actions = plan(
      input({
        pullRequests: [pr(5, SHA_A)],
        projects: [interrupted.project],
        deployments: [interrupted.deployment],
        images: [ready(5, SHA_A)],
      }),
    );

    expect(actions).toEqual([idleRemoval(interrupted, [])]);
  });

  test("an idle Preview doesn't count against a deploy in the same plan", () => {
    const stale = live(1, SEVEN_DAYS_AGO);
    const fresh = live(2, hoursAgo(1));

    const actions = plan(observing([stale, fresh], [pushed(9)], 2));

    expect(actions).toEqual([
      idleRemoval(stale, [10]),
      expect.objectContaining({ kind: "deploy", pr: 9 }),
    ]);
  });

  test("a closed PR's idle Preview is torn down as closed", () => {
    const one = live(5, SEVEN_DAYS_AGO);

    const actions = plan({ ...observing([one], [], 5), pullRequests: [] });

    expect(kinds(actions)).toEqual(["delete-resource", "teardown", "mark-inactive"]);
  });
});

const removedHead = (prNumber: number, sha: string, description: string) =>
  deployment(prNumber, sha, "inactive", { description });

describe("an evicted or idle head", () => {
  for (const description of ["evicted, push to rebuild", "idle for 7 days, push to rebuild"]) {
    test(`waits for the next push (${description})`, () => {
      const observed = input({
        pullRequests: [pr(5, SHA_A)],
        deployments: [removedHead(5, SHA_A, description)],
        images: [ready(5, SHA_A)],
      });

      expect(imagesToCheck(observed)).toEqual([]);
      expect(plan(observed)).toEqual([]);
    });
  }

  test("still waits after the PR is closed and reopened", () => {
    const evicted = removedHead(5, SHA_A, "evicted, push to rebuild");

    // Closed: nothing to mark, it is inactive already.
    expect(plan(input({ deployments: [evicted] }))).toEqual([]);
    // Reopened at the same commit.
    expect(plan(input({ pullRequests: [pr(5, SHA_A)], deployments: [evicted] }))).toEqual([]);
  });

  test("while a head marked `PR closed`, reopened, is deployed again", () => {
    const closed = removedHead(5, SHA_A, "PR closed");

    const actions = plan(input({ pullRequests: [pr(5, SHA_A)], deployments: [closed] }));

    expect(actions).toEqual([{ kind: "create-deployment", pr: 5, sha: SHA_A }]);
  });

  test("comes back on the next push", () => {
    const evicted = removedHead(5, SHA_A, "evicted, push to rebuild");

    const actions = plan(input({ pullRequests: [pr(5, SHA_B)], deployments: [evicted] }));

    expect(actions).toEqual([{ kind: "create-deployment", pr: 5, sha: SHA_B }]);
  });

  test("comes back as the newest Preview, so the next deploy evicts the others first", () => {
    const oldest = live(1, hoursAgo(3));
    const newer = live(2, hoursAgo(2));
    const evicted = removedHead(5, SHA_A, "evicted, push to rebuild");
    const observed = observing([oldest, newer], [pushed(5), pushed(9)], 2);

    const actions = plan({ ...observed, deployments: [evicted, ...observed.deployments] });

    expect(actions).toEqual([
      eviction(oldest),
      expect.objectContaining({ kind: "deploy", pr: 5, sha: SHA_B, supersedes: [] }),
      eviction(newer),
      expect.objectContaining({ kind: "deploy", pr: 9 }),
    ]);
  });

  test("whose Preview is still there, a removal cut off halfway, has it torn down", () => {
    const evicted = removedHead(5, SHA_A, "evicted, push to rebuild");
    const halfway = project(5, { sha: SHA_A });

    const actions = plan(
      input({
        pullRequests: [pr(5, SHA_A)],
        projects: [halfway],
        deployments: [evicted],
        resources: [resource(50, "pr-5.banki.dkomeza.com")],
      }),
    );

    expect(actions).toEqual([
      { kind: "delete-resource", pr: 5, resourceId: 50 },
      { kind: "teardown", project: halfway },
    ]);
  });

  test("marked idle, with only a volume left, has it torn down", () => {
    const idle = removedHead(5, SHA_A, "idle for 7 days, push to rebuild");

    const actions = plan(
      input({ pullRequests: [pr(5, SHA_A)], projects: [leftover(5)], deployments: [idle] }),
    );

    expect(actions).toEqual([{ kind: "teardown", project: leftover(5) }]);
  });

  test("whose Preview is still running doesn't count against a deploy", () => {
    const halfway = project(5, { sha: SHA_A, deployedAt: hoursAgo(1) });
    const observed = observing([live(1, hoursAgo(3))], [pushed(9)], 2);

    const actions = plan({
      ...observed,
      pullRequests: [...observed.pullRequests, pr(5, SHA_A)],
      projects: [...observed.projects, halfway],
      deployments: [...observed.deployments, removedHead(5, SHA_A, "evicted, push to rebuild")],
    });

    expect(kinds(actions)).toEqual(["teardown", "deploy"]);
  });
});

/** The observations once PR `<n>` has closed, its Preview still running. */
const closing = (observed: PlanInput, prNumber: number): PlanInput => ({
  ...observed,
  pullRequests: observed.pullRequests.filter((pull) => pull.number !== prNumber),
});

const needsOf = (actions: Action[], prNumber: number) =>
  actions.find((action) => action.kind === "deploy" && action.pr === prNumber);

describe("the cleanups a deploy needs", () => {
  test("none, when there's room for it even if every cleanup fails", () => {
    const gone = live(1, hoursAgo(1));
    const observed = observing([gone, live(2, hoursAgo(2))], [pushed(3)], 5);

    const actions = plan(closing(observed, 1));

    expect(kinds(actions)).toEqual(["delete-resource", "teardown", "mark-inactive", "deploy"]);
    expect(needsOf(actions, 3)).toMatchObject({ needs: [] });
  });

  test("a closed PR's running Preview, when the deploy fills the cap exactly", () => {
    const gone = live(1, hoursAgo(1));
    const observed = observing([gone, live(2, hoursAgo(2))], [pushed(3)], 2);

    const actions = plan(closing(observed, 1));

    expect(needsOf(actions, 3)).toMatchObject({ needs: [1] });
  });

  test("the oldest of the running cleanups, as many as there is no spare room for", () => {
    // Cap 3: PR 4 stays and PR 5 deploys, so one of PR 1's teardown and PR 2's
    // idle removal may fail. The oldest, PR 2's, is the one it counts on.
    const gone = live(1, hoursAgo(1));
    const stale = live(2, SEVEN_DAYS_AGO);
    const observed = observing([gone, stale, live(4, hoursAgo(2))], [pushed(5)], 3);

    const actions = plan(closing(observed, 1));

    expect(kinds(actions)).toEqual([
      "delete-resource",
      "teardown",
      "remove",
      "mark-inactive",
      "deploy",
    ]);
    expect(needsOf(actions, 5)).toMatchObject({ needs: [2] });
  });

  test("its evictions, which leave no spare room", () => {
    const oldest = live(1, hoursAgo(3));

    const actions = plan(observing([oldest, live(2, hoursAgo(2))], [pushed(3)], 2));

    expect(needsOf(actions, 3)).toMatchObject({ needs: [1] });
  });

  test("never the PR's own idle Preview, which the deploy replaces anyway", () => {
    const own = live(1, SEVEN_DAYS_AGO);
    const observed = observing([own], [pushed(1)], 1);

    const actions = plan({ ...observed, deployments: [own.deployment, ...observed.deployments] });

    expect(kinds(actions)).toEqual(["remove", "deploy"]);
    expect(needsOf(actions, 1)).toMatchObject({ needs: [] });
  });

  test("never one that isn't running, which never counted", () => {
    const volumeOnly = { ...leftover(1), deployedAt: SEVEN_DAYS_AGO };
    const observed = observing([live(2, hoursAgo(2))], [pushed(3)], 2);

    const actions = plan({
      ...observed,
      pullRequests: [...observed.pullRequests, pr(1, SHA_A)],
      projects: [...observed.projects, volumeOnly],
      deployments: [...observed.deployments, deployment(1, SHA_A, "failure")],
    });

    expect(kinds(actions)).toEqual(["remove", "deploy"]);
    expect(needsOf(actions, 3)).toMatchObject({ needs: [] });
  });
});
