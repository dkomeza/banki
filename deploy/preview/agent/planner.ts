import { prFromHost, REPO } from "./naming";

// The reconcile loop's one decision: given what Docker, GitHub, GHCR and
// Pangolin say right now, and the time, which actions bring the Previews in
// line with the open pull requests. It is pure: the adapters observe, the
// planner decides, the adapters act. The agent keeps no state of its own, so a
// restart loses nothing (ADR-0008).

/** An open pull request. */
export type PullRequest = {
  number: number;
  headSha: string;
  /** The head repo's `owner/name`, or undefined when that repo is gone. */
  headRepo: string | undefined;
  /** The author's login, such as `dependabot[bot]`. */
  author: string;
};

export type ImageDigests = { api: string; web: string };

/** A container's state, or `missing` when the project has none for that service. */
export type ServiceState = "running" | "stopped" | "missing";

/**
 * A Compose project `banki-pr-<N>`, found from any of its containers, volumes
 * or networks. The labels come from whichever of those carry them.
 */
export type DockerProject = {
  pr: number;
  sha: string | undefined;
  deployedAt: Date | undefined;
  /** The images it was deployed from, so a teardown can remove them. */
  digests: ImageDigests | undefined;
  api: ServiceState;
  web: ServiceState;
};

export type DeploymentStatus =
  | "pending"
  | "queued"
  | "in_progress"
  | "success"
  | "failure"
  | "error"
  | "inactive";

/** A `preview` Deployment, with the PR from its `payload.pr`. */
export type Deployment = {
  id: number;
  pr: number;
  sha: string;
  createdAt: Date;
  /** Its latest status, or undefined when it has none yet. */
  status: DeploymentStatus | undefined;
};

/** Both images of PR `<pr>`'s push of `<sha>` exist, tagged `pr-<pr>-<sha>`. */
export type ImagesReady = { pr: number; sha: string; digests: ImageDigests };

/** A Pangolin public resource, with the sites its targets are on. */
export type PangolinResource = { resourceId: number; fullDomain: string; siteIds: number[] };

export type PlanInput = {
  /** Every open pull request, targets or not. */
  pullRequests: PullRequest[];
  projects: DockerProject[];
  deployments: Deployment[];
  /** The images that exist, for the PRs {@link imagesToCheck} named. */
  images: ImagesReady[];
  /** The resources on the Previews site, owned by the agent or not. */
  resources: PangolinResource[];
  /** The Previews site's numeric ID. */
  siteId: number;
  now: Date;
};

export type Action =
  /** Create a Deployment for the PR's head and mark it queued. */
  | { kind: "create-deployment"; pr: number; sha: string }
  /** Give a Deployment created without a status its queued status. */
  | { kind: "mark-queued"; pr: number; sha: string; deploymentId: number }
  /**
   * Deploy the head from scratch over whatever project the PR has, then mark
   * the Deployments it supersedes inactive. See deploy.ts.
   */
  | {
      kind: "deploy";
      pr: number;
      sha: string;
      deploymentId: number;
      digests: ImageDigests;
      /** The PR's project as it is now, which the deploy takes down first. */
      previous: DockerProject | undefined;
      supersedes: number[];
      deployedAt: Date;
    }
  /** `down -v --remove-orphans --rmi all`: containers, volumes, networks and images. */
  | { kind: "teardown"; project: DockerProject }
  | { kind: "mark-inactive"; pr: number; deploymentId: number; reason: "closed" | "superseded" }
  /** Create the PR's resource, with SSO off and its target on the Previews site. */
  | { kind: "create-resource"; pr: number }
  | { kind: "delete-resource"; pr: number; resourceId: number };

/**
 * Whether an open PR gets a Preview: the same rule as the preview-images
 * workflow, so a PR gets one exactly when CI builds its images. Fork PRs'
 * code must never run on the home server, and Dependabot's PRs get no images.
 */
const isTarget = (pull: PullRequest) =>
  pull.headRepo?.toLowerCase() === REPO.toLowerCase() && pull.author !== "dependabot[bot]";

/**
 * The resources the agent owns: a target on the Previews site and exactly a
 * Preview's host name. Pangolin's own search is a substring match, so it is
 * never trusted; every other resource is left alone.
 */
export function ownedResources(
  resources: PangolinResource[],
  siteId: number,
): { pr: number; resourceId: number }[] {
  return resources.flatMap((resource) => {
    const pr = prFromHost(resource.fullDomain);
    return pr !== undefined && resource.siteIds.includes(siteId)
      ? [{ pr, resourceId: resource.resourceId }]
      : [];
  });
}

export function plan(input: PlanInput): Action[] {
  const targets = new Map(
    input.pullRequests.filter(isTarget).map((pull) => [pull.number, pull] as const),
  );
  const projectOf = new Map(input.projects.map((project) => [project.pr, project] as const));
  const owned = ownedResources(input.resources, input.siteId);

  // A resource exists exactly while its PR is an open target and its `web` runs.
  const wantsResource = (pr: number) => targets.has(pr) && projectOf.get(pr)?.web === "running";

  const deleteResources: Action[] = owned
    .filter((resource) => !wantsResource(resource.pr))
    .map((resource) => ({ kind: "delete-resource", ...resource }));

  const teardowns: Action[] = input.projects
    .filter((project) => !targets.has(project.pr))
    .map((project) => ({ kind: "teardown", project }));

  const closedDeployments: Action[] = input.deployments
    .filter((deployment) => !targets.has(deployment.pr) && deployment.status !== "inactive")
    .map((deployment) => ({
      kind: "mark-inactive",
      pr: deployment.pr,
      deploymentId: deployment.id,
      reason: "closed",
    }));

  const supersededDeployments: Action[] = [];
  const createDeployments: Action[] = [];
  const markQueued: Action[] = [];
  const deploys: Extract<Action, { kind: "deploy" }>[] = [];
  for (const pull of targets.values()) {
    const head = headDeployment(input.deployments, pull);
    const others = input.deployments.filter(
      (deployment) =>
        deployment.pr === pull.number &&
        deployment.id !== head?.id &&
        deployment.status !== "inactive",
    );
    // An inactive head is a PR reopened at the commit it closed on.
    if (head === undefined || head.status === "inactive") {
      createDeployments.push({ kind: "create-deployment", pr: pull.number, sha: pull.headSha });
      continue;
    }
    // A success is done, and a failure waits for the next push. Either way the
    // head's deploy took down whatever Preview the older Deployments made.
    if (!isWaiting(head)) {
      for (const deployment of others) {
        supersededDeployments.push({
          kind: "mark-inactive",
          pr: pull.number,
          deploymentId: deployment.id,
          reason: "superseded",
        });
      }
      continue;
    }
    const images = input.images.find(
      (image) => image.pr === pull.number && image.sha === pull.headSha,
    );
    if (images === undefined) {
      if (head.status === undefined || head.status === "pending") {
        markQueued.push({
          kind: "mark-queued",
          pr: pull.number,
          sha: pull.headSha,
          deploymentId: head.id,
        });
      }
      continue;
    }
    // Queued, or in progress when the agent stopped mid-deploy: in progress is
    // only ever seen by a planner that runs after the deploy was cut short,
    // since one action runs at a time. Either way, from scratch.
    deploys.push({
      kind: "deploy",
      pr: pull.number,
      sha: pull.headSha,
      deploymentId: head.id,
      digests: images.digests,
      previous: projectOf.get(pull.number),
      supersedes: others.map((deployment) => deployment.id),
      deployedAt: input.now,
    });
  }

  // A deploy ends by creating or keeping the resource itself.
  const deploying = new Set(deploys.map((action) => action.pr));
  const createResources: Action[] = [...targets.keys()]
    .filter(
      (pr) =>
        wantsResource(pr) && !deploying.has(pr) && !owned.some((resource) => resource.pr === pr),
    )
    .map((pr) => ({ kind: "create-resource", pr }));

  return [
    ...deleteResources,
    ...teardowns,
    ...closedDeployments,
    ...supersededDeployments,
    ...createResources,
    ...createDeployments,
    ...markQueued,
    ...deploys,
  ];
}

/** Whether the Deployment still waits to be deployed: for its images, or to be redone. */
const isWaiting = (deployment: Deployment) =>
  deployment.status === undefined ||
  deployment.status === "pending" ||
  deployment.status === "queued" ||
  deployment.status === "in_progress";

/** The newest Deployment of the PR's head commit, if there is one. */
function headDeployment(deployments: Deployment[], pull: PullRequest): Deployment | undefined {
  return newestFirst(
    deployments.filter(
      (deployment) => deployment.pr === pull.number && deployment.sha === pull.headSha,
    ),
  )[0];
}

const newestFirst = (deployments: Deployment[]) =>
  deployments.toSorted((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id - a.id);

/**
 * The PRs and SHAs whose images the loop must look up in GHCR before it plans:
 * each target's head whose Deployment is waiting to be deployed.
 */
export function imagesToCheck(input: Omit<PlanInput, "images">): { pr: number; sha: string }[] {
  return input.pullRequests
    .filter(isTarget)
    .filter((pull) => {
      const head = headDeployment(input.deployments, pull);
      return head !== undefined && isWaiting(head);
    })
    .map((pull) => ({ pr: pull.number, sha: pull.headSha }));
}
