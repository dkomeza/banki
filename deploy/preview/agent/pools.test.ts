import { describe, expect, test } from "bun:test";
import { projectsFrom, slugProjectsFrom } from "./docker";
import { type Deployment, type PlanInput, plan } from "./planner";
import { planSlugs, type SlugDeployment, type SlugPlanInput } from "./slug-planner";

// The two pools share one Docker daemon, one Pangolin site and one loop, but
// each has its own cap (ADR-0011). These tests start from one `docker ps`
// listing holding both pools' projects, as the agent sees it, and check that
// filling either pool evicts only its own Previews.

const NOW = new Date("2026-10-20T12:00:00Z");
const SHA = "a".repeat(40);
const NEW_SHA = "b".repeat(40);
const API = `sha256:${"1".repeat(64)}`;
const WEB = `sha256:${"2".repeat(64)}`;
const digests = { api: API, web: WEB };

/** A running project's two containers, deployed `minutesAgo`. */
const running = (project: string, minutesAgo: number) => {
  const at = new Date(NOW.getTime() - minutesAgo * 60_000).toISOString();
  return ["api", "web"]
    .map((service) => [project, SHA, at, API, WEB, service, "False", "running"].join("\t"))
    .join("\n");
};

/** PR Previews 1..`prs` and Slug Previews s1..s`slugs`, the PR ones older than every Slug one. */
function listing(prs: number, slugs: number) {
  const containers = [
    ...Array.from({ length: prs }, (_, index) => running(`banki-pr-${index + 1}`, 1000 - index)),
    ...Array.from({ length: slugs }, (_, index) =>
      running(`banki-slug-s${index + 1}`, 100 - index),
    ),
  ].join("\n");
  const listed = { containers, volumes: "", networks: "" };
  return { prs: projectsFrom(listed), slugs: slugProjectsFrom(listed) };
}

let nextId = 1;
const prDeployment = (pr: number, sha: string, status: Deployment["status"]): Deployment => ({
  id: nextId++,
  pr,
  sha,
  createdAt: new Date(NOW.getTime() - 3_600_000),
  status,
  description: undefined,
});
const slugDeployment = (
  slug: string,
  sha: string,
  status: SlugDeployment["status"],
): SlugDeployment => ({
  id: nextId++,
  sha,
  createdAt: new Date(NOW.getTime() - 3_600_000),
  status,
  description: undefined,
  payload: { slug, ref: `proto/${slug}`, sha, ttlHours: 72 },
});

function plans(options: { prs: number; slugs: number; prDeploy?: number; slugDeploy?: string }) {
  const projects = listing(options.prs, options.slugs);
  const prInput: PlanInput = {
    pullRequests: [
      ...projects.prs.map((project) => ({
        number: project.pr,
        headSha: SHA,
        headRepo: "dkomeza/banki",
        author: "dkomeza",
      })),
      ...(options.prDeploy === undefined
        ? []
        : [
            {
              number: options.prDeploy,
              headSha: NEW_SHA,
              headRepo: "dkomeza/banki",
              author: "dkomeza",
            },
          ]),
    ],
    projects: projects.prs,
    deployments: [
      ...projects.prs.map((project) => prDeployment(project.pr, SHA, "success")),
      ...(options.prDeploy === undefined
        ? []
        : [prDeployment(options.prDeploy, NEW_SHA, "queued")]),
    ],
    images: options.prDeploy === undefined ? [] : [{ pr: options.prDeploy, sha: NEW_SHA, digests }],
    resources: [],
    siteId: 7,
    limits: { cap: 5, idleDays: 7 },
    now: NOW,
  };
  const slugInput: SlugPlanInput = {
    projects: projects.slugs,
    deployments: [
      ...projects.slugs.map((project) => slugDeployment(project.slug, SHA, "success")),
      ...(options.slugDeploy === undefined
        ? []
        : [slugDeployment(options.slugDeploy, NEW_SHA, "queued")]),
    ],
    images:
      options.slugDeploy === undefined ? [] : [{ slug: options.slugDeploy, sha: NEW_SHA, digests }],
    missing: [],
    resources: [],
    siteId: 7,
    limits: { cap: 9 },
    now: NOW,
  };
  return { pr: plan(prInput), slug: planSlugs(slugInput) };
}

const removed = (actions: { kind: string }[]) =>
  actions.flatMap((action) =>
    action.kind === "remove" && "pr" in action
      ? [action.pr]
      : action.kind === "remove" && "slug" in action
        ? [action.slug]
        : [],
  );
const deployed = (actions: { kind: string }[]) =>
  actions.flatMap((action) =>
    action.kind !== "deploy"
      ? []
      : "pr" in action
        ? [action.pr]
        : "slug" in action
          ? [action.slug]
          : [],
  );

describe("the two pools", () => {
  test("a PR deploy into a full PR pool evicts the oldest PR Preview, never a Slug Preview, though those are newer", () => {
    const { pr, slug } = plans({ prs: 5, slugs: 9, prDeploy: 6 });

    expect(removed(pr)).toEqual([1]);
    expect(deployed(pr)).toEqual([6]);
    expect(removed(slug)).toEqual([]);
  });

  test("a Slug deploy into a full slug pool evicts the oldest Slug Preview, never a PR Preview, though those are older", () => {
    const { pr, slug } = plans({ prs: 5, slugs: 9, slugDeploy: "blue" });

    expect(removed(slug)).toEqual(["s1"]);
    expect(deployed(slug)).toEqual(["blue"]);
    expect(removed(pr)).toEqual([]);
  });

  test("Slug Previews don't count against the PR Previews' cap, nor PR Previews against the Slugs'", () => {
    const prDeploy = plans({ prs: 4, slugs: 9, prDeploy: 6 });
    const slugDeploy = plans({ prs: 5, slugs: 8, slugDeploy: "blue" });

    expect(removed([...prDeploy.pr, ...prDeploy.slug])).toEqual([]);
    expect(deployed(prDeploy.pr)).toEqual([6]);
    expect(removed([...slugDeploy.pr, ...slugDeploy.slug])).toEqual([]);
    expect(deployed(slugDeploy.slug)).toEqual(["blue"]);
  });
});
