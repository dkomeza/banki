import { isSlug, projectName, slugFromHost } from "./naming";
import { isRecord } from "./parse";
import {
  type DeploymentStatus,
  type DockerProject,
  holdsRoom,
  type ImageDigests,
  isWaiting,
  type PangolinResource,
  type PlanParts,
} from "./planner";

// The slug pool's one decision, beside planner.ts's for the PR pool
// (ADR-0011): given what Docker, GitHub, GHCR and Pangolin say right now, and
// the time, which actions bring the Slug Previews in line with the
// `slug-preview` Deployments. There are no pull requests here: a Slug Preview
// is wanted while its Slug's newest Deployment isn't inactive and its time to
// live hasn't run out. It is pure, and the agent keeps no state of its own,
// so a restart loses nothing (ADR-0008). Its cap and evictions count only
// Slug Previews, so the two pools never push each other's Previews out.

/** The longest time to live a Slug Preview may ask for: two weeks. */
export const MAX_TTL_HOURS = 336;

/** A Compose project `banki-slug-<slug>`, found from any of its containers, volumes or networks. */
export type SlugProject = Omit<DockerProject, "pr"> & { slug: string };

/** A `slug-preview` Deployment, as the slug-preview workflow creates it. */
export type SlugDeployment = {
  id: number;
  /** The commit it deploys: the Deployment's ref, which the workflow sets to the branch's head. */
  sha: string;
  createdAt: Date;
  /** Its latest status, or undefined when it has none yet. */
  status: DeploymentStatus | undefined;
  /** Its latest status's description. */
  description: string | undefined;
  /** Its payload, decoded but not yet checked: see {@link slugPayload}. */
  payload: unknown;
};

/** What a good payload says: `{ slug, ref, sha, ttlHours }`, its time to live clamped. */
export type SlugPayload = { slug: string; ref: string; ttlHours: number };

/** Both images of the Slug's build of `<sha>` exist, tagged `slug-<slug>-<sha>`. */
export type SlugImagesReady = { slug: string; sha: string; digests: ImageDigests };

/** At most `cap` Slug Previews run at once. */
export type SlugLimits = { cap: number };

export type SlugPlanInput = {
  projects: SlugProject[];
  /** Every `slug-preview` Deployment read, good payloads or not. */
  deployments: SlugDeployment[];
  /** The images that exist, for the builds {@link slugImagesToCheck} named. */
  images: SlugImagesReady[];
  /** Every resource of the org, owned by the agent or not. */
  resources: PangolinResource[];
  /** The Previews site's numeric ID. */
  siteId: number;
  limits: SlugLimits;
  now: Date;
};

/** Every slug pool action says so, which tells it apart from a PR Preview's. */
type InSlugPool<T> = T & { pool: "slug" };

export type SlugAction = InSlugPool<
  | { kind: "mark-queued"; slug: string; sha: string; deploymentId: number }
  /**
   * Deploy the newest Deployment from scratch over whatever project the Slug
   * has, then mark the Deployments it supersedes inactive. See deploy.ts.
   */
  | {
      kind: "deploy";
      slug: string;
      sha: string;
      deploymentId: number;
      digests: ImageDigests;
      /** The Slug's project as it is now, which the deploy takes down first. */
      previous: SlugProject | undefined;
      supersedes: number[];
      deployedAt: Date;
      /** The Slugs whose running Preview the cap counts on being gone first, as planner.ts's `needs`. */
      needs: string[];
    }
  /** Check the Preview this Deployment already made, without taking it down, as planner.ts's. */
  | {
      kind: "confirm";
      slug: string;
      sha: string;
      deploymentId: number;
      project: SlugProject;
      supersedes: number[];
    }
  /** `down -v --remove-orphans --rmi all`: containers, volumes, networks and images. */
  | { kind: "teardown"; project: SlugProject }
  /**
   * Evict a Slug Preview to make room, or remove it once its time to live has
   * run out: first mark its Deployment inactive with `description`, so it
   * stays down until it is dispatched again, then delete its resources and
   * tear its project down, if it has one.
   */
  | {
      kind: "remove";
      slug: string;
      reason: "evicted" | "expired";
      description: string;
      project: SlugProject | undefined;
      /** The Deployment to mark, or undefined to mark none. */
      deploymentId: number | undefined;
      resourceIds: number[];
    }
  | { kind: "mark-inactive"; slug: string; deploymentId: number; reason: "superseded" }
  /** Mark a Deployment whose payload is malformed, or whose Slug is invalid or reserved, a failure. */
  | { kind: "mark-invalid"; deploymentId: number }
  /** Mark a Deployment a failure, such as one whose images never arrived. */
  | { kind: "mark-failed"; slug: string; deploymentId: number; description: string }
  /** Create the Slug's resource, with SSO off and its target on the Previews site. */
  | { kind: "create-resource"; slug: string }
  | { kind: "delete-resource"; slug: string; resourceId: number }
>;

type Deploy = Extract<SlugAction, { kind: "deploy" }>;
type Remove = Extract<SlugAction, { kind: "remove" }>;

/** A Deployment with a good payload. */
type Checked = SlugDeployment & SlugPayload;

/**
 * The payload of a Deployment the slug-preview workflow made, or undefined
 * for any other: one that isn't an object, a Slug that is invalid or
 * reserved, an empty branch, another commit than the Deployment's own, or a
 * time to live that isn't a positive whole number of hours.
 */
export function slugPayload(deployment: SlugDeployment): SlugPayload | undefined {
  const payload = deployment.payload;
  if (!isRecord(payload)) return undefined;
  const { slug, ref, sha, ttlHours } = payload;
  if (typeof slug !== "string" || !isSlug(slug)) return undefined;
  if (typeof ref !== "string" || ref === "") return undefined;
  if (typeof sha !== "string" || sha.toLowerCase() !== deployment.sha.toLowerCase()) {
    return undefined;
  }
  if (typeof ttlHours !== "number" || !Number.isInteger(ttlHours) || ttlHours < 1) {
    return undefined;
  }
  return { slug, ref, ttlHours: Math.min(ttlHours, MAX_TTL_HOURS) };
}

export type OwnedSlugResource = { slug: string; resourceId: number; orphan: boolean };

/**
 * The resources the slug pool owns: exactly a valid Slug's host name, and
 * either a target on the Previews site, or no targets at all and the agent's
 * name for it, `banki-slug-<slug>` (an orphan, cut short before its target).
 * A PR Preview's host is never a valid Slug's, so neither pool owns the
 * other's; every other resource is left alone.
 */
export function ownedSlugResources(
  resources: PangolinResource[],
  siteId: number,
): OwnedSlugResource[] {
  return resources.flatMap((resource): OwnedSlugResource[] => {
    const slug = slugFromHost(resource.fullDomain);
    if (slug === undefined) return [];
    if (resource.siteIds.includes(siteId)) {
      return [{ slug, resourceId: resource.resourceId, orphan: false }];
    }
    if (!resource.hasTargets && resource.name === projectName(slug)) {
      return [{ slug, resourceId: resource.resourceId, orphan: true }];
    }
    return [];
  });
}

export function planSlugs(input: SlugPlanInput): SlugAction[] {
  const { upkeep, deploys } = planSlugParts(input);
  return [...upkeep, ...deploys];
}

export function planSlugParts(input: SlugPlanInput): PlanParts<SlugAction> {
  const owned = ownedSlugResources(input.resources, input.siteId);
  const projectOf = new Map(input.projects.map((project) => [project.slug, project] as const));
  const checked = checkedDeployments(input.deployments);
  const newest = newestOfEach(checked);
  const ownedBy = (slug: string) =>
    owned.filter((resource) => resource.slug === slug).map((resource) => resource.resourceId);

  // A bad payload is never deployed, and marked a failure once.
  const markInvalid: SlugAction[] = input.deployments
    .filter(
      (deployment) =>
        slugPayload(deployment) === undefined &&
        deployment.status !== "failure" &&
        deployment.status !== "inactive",
    )
    .map((deployment) => ({ pool: "slug", kind: "mark-invalid", deploymentId: deployment.id }));

  // Its time to live run out, the newest is marked inactive first, then its
  // Preview goes; should that fail, the next loop finds it inactive and
  // finishes it.
  const expiries: Remove[] = [...newest.values()]
    .filter((head) => head.status !== "inactive" && isExpired(head, input.now))
    .map((head) => {
      const project = projectOf.get(head.slug);
      return {
        pool: "slug",
        kind: "remove",
        slug: head.slug,
        reason: "expired",
        description: `expired after ${head.ttlHours} h${DISPATCH_AGAIN}`,
        project,
        deploymentId: head.id,
        resourceIds: ownedBy(head.slug),
      };
    });
  const expiring = new Set(expiries.map((action) => action.slug));
  const wanted = (slug: string) => {
    const head = newest.get(slug);
    return head !== undefined && head.status !== "inactive" && !expiring.has(slug);
  };

  // A failed newest Deployment means nothing serves its Slug. A failed deploy
  // left its own project stopped, which holds no room and is left alone; but
  // a failed build never deployed, so a project an older Deployment left
  // running goes, whatever its commit (a dispatch at the same head fails in
  // the workflow too). The Slug stays held until the failed one goes inactive.
  const stale = (project: SlugProject) => {
    const head = newest.get(project.slug);
    return (
      head !== undefined &&
      (head.status === "failure" || head.status === "error") &&
      holdsRoom(project)
    );
  };

  // Once the newest Deployment is done (or now expiring), the older ones are
  // done with: its deploy took down whatever Preview they made, or, when it
  // never deployed, its failure does (see `stale`).
  const superseded: SlugAction[] = [];
  for (const head of newest.values()) {
    if (isWaiting(head) && !expiring.has(head.slug)) continue;
    for (const older of olderOf(checked, head)) {
      superseded.push({
        pool: "slug",
        kind: "mark-inactive",
        slug: head.slug,
        deploymentId: older.id,
        reason: "superseded",
      });
    }
  }

  const markQueued: SlugAction[] = [];
  const markFailed: SlugAction[] = [];
  const confirms: Extract<SlugAction, { kind: "confirm" }>[] = [];
  const deploys: Deploy[] = [];
  for (const head of newest.values()) {
    if (!wanted(head.slug) || !isWaiting(head)) continue;
    const project = projectOf.get(head.slug);
    const supersedes = olderOf(checked, head).map((older) => older.id);
    // Running at its commit since this Deployment was made: a deploy got that
    // far, but its success was never recorded. One deployed before it, at the
    // same commit, is a Slug dispatched again, which rebuilds from scratch.
    if (
      project !== undefined &&
      project.sha === head.sha &&
      project.api === "running" &&
      project.web === "running" &&
      project.deployedAt !== undefined &&
      project.deployedAt.getTime() >= head.createdAt.getTime()
    ) {
      confirms.push({
        pool: "slug",
        kind: "confirm",
        slug: head.slug,
        sha: head.sha,
        deploymentId: head.id,
        project,
        supersedes,
      });
      continue;
    }
    const images = input.images.find((image) => image.slug === head.slug && image.sha === head.sha);
    if (images === undefined) {
      // An image can go missing for good: a sweep deleting it just as a
      // dispatch at the same head found it already pushed. Waiting longer
      // than any build takes, the Deployment fails visibly instead of
      // waiting out its time to live, and dispatching again rebuilds it. One
      // the agent stopped in the middle of deploying had its images.
      if (
        head.status !== "in_progress" &&
        input.now.getTime() - head.createdAt.getTime() >= IMAGES_WAIT_MS
      ) {
        markFailed.push({
          pool: "slug",
          kind: "mark-failed",
          slug: head.slug,
          deploymentId: head.id,
          description: "images never arrived, dispatch again",
        });
      } else if (head.status === undefined || head.status === "pending") {
        markQueued.push({
          pool: "slug",
          kind: "mark-queued",
          slug: head.slug,
          sha: head.sha,
          deploymentId: head.id,
        });
      }
      continue;
    }
    deploys.push({
      pool: "slug",
      kind: "deploy",
      slug: head.slug,
      sha: head.sha,
      deploymentId: head.id,
      digests: images.digests,
      previous: project,
      supersedes,
      deployedAt: input.now,
      needs: [],
    });
  }

  // The cap, with planner.ts's arithmetic: each deploy admits one more
  // running Preview, and right before it as many of the running ones as the
  // cap needs make room, oldest last deploy first. The Slug's own counts for
  // nothing, since the deploy replaces it, and one with a deploy of its own in
  // this plan goes only when nothing else can. The running Previews being
  // torn down or removed in this plan count as gone; should those fail, a
  // deploy needs as many of them as it has no spare room for.
  const leaving = (project: SlugProject) => !wanted(project.slug) || stale(project);
  const cleanups = input.projects.filter((project) => holdsRoom(project) && leaving(project));
  const redeploying = new Set(deploys.map((action) => action.slug));
  const deploysMakingRoom: SlugAction[] = [];
  const evictions: Remove[] = [];
  let running = input.projects
    .filter((project) => holdsRoom(project) && !leaving(project))
    .toSorted(byLastDeploy);
  for (const action of deploys) {
    const others = running.filter((project) => project.slug !== action.slug);
    const excess = Math.max(0, others.length + 1 - input.limits.cap);
    const evicted = [
      ...others.filter((project) => !redeploying.has(project.slug)),
      ...others.filter((project) => redeploying.has(project.slug)),
    ].slice(0, excess);
    for (const project of evicted) {
      const eviction = evictionOf(project, checked, newest, ownedBy(project.slug));
      evictions.push(eviction);
      deploysMakingRoom.push(eviction);
    }
    const staying = others.filter((project) => !evicted.includes(project));
    const spare = input.limits.cap - (staying.length + 1);
    const freeing = [
      ...cleanups,
      ...evictions.flatMap((eviction) =>
        eviction.project === undefined ? [] : [eviction.project],
      ),
    ]
      .filter((project) => project.slug !== action.slug)
      .toSorted(byLastDeploy);
    const needs = freeing.slice(0, Math.max(0, freeing.length - spare));
    deploysMakingRoom.push({ ...action, needs: needs.map((project) => project.slug) });
    running = [...staying, deployed(action)];
  }

  // A resource exists exactly while its Slug is wanted, its `web` runs and
  // it isn't being removed. A removal deletes its Slug's resources itself,
  // after marking the Deployment.
  const removing = new Set([...expiries, ...evictions].map((action) => action.slug));
  const wantsResource = (slug: string) => {
    const project = projectOf.get(slug);
    return wanted(slug) && project?.web === "running" && !stale(project) && !removing.has(slug);
  };

  const deleteResources: SlugAction[] = owned
    .filter(
      (resource) =>
        (resource.orphan || !wantsResource(resource.slug)) && !removing.has(resource.slug),
    )
    .map((resource) => ({
      pool: "slug",
      kind: "delete-resource",
      slug: resource.slug,
      resourceId: resource.resourceId,
    }));

  const teardowns: SlugAction[] = input.projects
    .filter((project) => leaving(project) && !expiring.has(project.slug))
    .map((project) => ({ pool: "slug", kind: "teardown", project }));

  // A deploy or a confirm ends by creating or keeping the resource itself.
  const deploying = new Set([...deploys, ...confirms].map((action) => action.slug));
  const createResources: SlugAction[] = input.projects
    .filter(
      (project) =>
        wantsResource(project.slug) &&
        !deploying.has(project.slug) &&
        !owned.some((resource) => resource.slug === project.slug && !resource.orphan),
    )
    .map((project) => ({ pool: "slug", kind: "create-resource", slug: project.slug }));

  return {
    upkeep: [
      ...deleteResources,
      ...teardowns,
      ...expiries,
      ...markInvalid,
      ...superseded,
      ...createResources,
      ...markQueued,
      ...markFailed,
      ...confirms,
    ],
    deploys: deploysMakingRoom,
  };
}

const DISPATCH_AGAIN = ", dispatch again to rebuild";

/** How long a Deployment waits for its images before it fails: longer than any build. */
const IMAGES_WAIT_MS = 3_600_000;

const HOUR_MS = 3_600_000;

/** Whether the Deployment's time to live, counted from its creation, has run out. */
const isExpired = (deployment: Checked, now: Date) =>
  now.getTime() - deployment.createdAt.getTime() >= deployment.ttlHours * HOUR_MS;

/** The Deployments with a good payload, each with what it says. */
const checkedDeployments = (deployments: SlugDeployment[]): Checked[] =>
  deployments.flatMap((deployment) => {
    const payload = slugPayload(deployment);
    return payload === undefined ? [] : [{ ...deployment, ...payload }];
  });

/** Each Slug's newest Deployment, the Slugs in alphabetical order. */
function newestOfEach(checked: Checked[]): Map<string, Checked> {
  const newest = new Map<string, Checked>();
  for (const deployment of newestFirst(checked)) {
    if (!newest.has(deployment.slug)) newest.set(deployment.slug, deployment);
  }
  return new Map([...newest].toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** The Slug's Deployments other than its newest that aren't inactive yet. */
const olderOf = (checked: Checked[], head: Checked) =>
  checked.filter(
    (deployment) =>
      deployment.slug === head.slug &&
      deployment.id !== head.id &&
      deployment.status !== "inactive",
  );

const newestFirst = <T extends { createdAt: Date; id: number }>(deployments: T[]) =>
  deployments.toSorted((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id - a.id);

/** Oldest last deploy first, a missing label oldest of all; a tie goes to the Slug first in the alphabet. */
const byLastDeploy = (a: SlugProject, b: SlugProject) =>
  (a.deployedAt?.getTime() ?? -Infinity) - (b.deployedAt?.getTime() ?? -Infinity) ||
  (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0);

/** The project a deploy leaves running, if it succeeds. */
const deployed = (action: Deploy): SlugProject => ({
  slug: action.slug,
  sha: action.sha,
  deployedAt: action.deployedAt,
  digests: action.digests,
  api: "running",
  web: "running",
});

/**
 * Evicting a Slug Preview: the Deployment that made it (its Slug's newest at
 * its commit) is marked first, unless that is the newest still waiting to
 * deploy, which then deploys anyway over whatever is left.
 */
function evictionOf(
  project: SlugProject,
  checked: Checked[],
  newest: Map<string, Checked>,
  resourceIds: number[],
): Remove {
  const made = newestFirst(
    checked.filter(
      (deployment) => deployment.slug === project.slug && deployment.sha === project.sha,
    ),
  )[0];
  const waitingHead =
    made !== undefined && made.id === newest.get(project.slug)?.id && isWaiting(made);
  return {
    pool: "slug",
    kind: "remove",
    slug: project.slug,
    reason: "evicted",
    description: `evicted${DISPATCH_AGAIN}`,
    project,
    deploymentId: waitingHead ? undefined : made?.id,
    resourceIds,
  };
}

/** The builds whose images the loop must look up in GHCR before it plans: each wanted Slug's newest still waiting. */
export function slugImagesToCheck(
  input: Omit<SlugPlanInput, "images">,
): { slug: string; sha: string }[] {
  return [...newestOfEach(checkedDeployments(input.deployments)).values()]
    .filter((head) => head.status !== "inactive" && !isExpired(head, input.now) && isWaiting(head))
    .map((head) => ({ slug: head.slug, sha: head.sha }));
}

/**
 * Whether the loop, reading the `slug-preview` Deployments newest first, has
 * read enough to plan, as planner.ts's readEnoughDeployments: every Slug
 * Preview's Deployment at its commit is among those read (an eviction marks
 * it first, and once the Preview is gone nothing could find it again), and
 * the page just read holds only settled ones: inactive, or a bad payload
 * already marked a failure. The agent's full reads catch the rest.
 */
export function readEnoughSlugDeployments(
  projects: SlugProject[],
  read: SlugDeployment[],
  lastPage: SlugDeployment[],
): boolean {
  const checked = checkedDeployments(read);
  return (
    projects.every(
      (project) =>
        project.sha === undefined ||
        checked.some(
          (deployment) => deployment.slug === project.slug && deployment.sha === project.sha,
        ),
    ) &&
    lastPage.every(
      (deployment) =>
        deployment.status === "inactive" ||
        (deployment.status === "failure" && slugPayload(deployment) === undefined),
    )
  );
}
