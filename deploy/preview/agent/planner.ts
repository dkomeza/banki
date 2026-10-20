import { prFromHost, projectName, REPO } from "./naming";

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
  /** Its latest status's description, which says why it went inactive. */
  description: string | undefined;
};

/** Both images of PR `<pr>`'s push of `<sha>` exist, tagged `pr-<pr>-<sha>`. */
export type ImagesReady = { pr: number; sha: string; digests: ImageDigests };

/** A Pangolin public resource of the org, with the sites its targets are on. */
export type PangolinResource = {
  resourceId: number;
  fullDomain: string;
  name: string;
  siteIds: number[];
  hasTargets: boolean;
};

/**
 * The home server runs other things too, so Previews are bounded: at most
 * `cap` running at once, and each removed `idleDays` after its last deploy.
 */
export type Limits = { cap: number; idleDays: number };

export type PlanInput = {
  /** Every open pull request, targets or not. */
  pullRequests: PullRequest[];
  projects: DockerProject[];
  deployments: Deployment[];
  /** The images that exist, for the PRs {@link imagesToCheck} named. */
  images: ImagesReady[];
  /** Every resource of the org, owned by the agent or not. */
  resources: PangolinResource[];
  /** The Previews site's numeric ID. */
  siteId: number;
  limits: Limits;
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
  /**
   * Check the head's Preview, already running at that commit, without taking
   * it down: its health, then its resource and the Deployment's success. For a
   * deploy whose success was never recorded (a failed write, or a restart).
   */
  | {
      kind: "confirm";
      pr: number;
      sha: string;
      deploymentId: number;
      project: DockerProject;
      supersedes: number[];
    }
  /** `down -v --remove-orphans --rmi all`: containers, volumes, networks and images. */
  | { kind: "teardown"; project: DockerProject }
  /**
   * Evict an open PR's Preview to make room, or remove it for going idle:
   * first mark the Deployment that made it inactive with `description`, so it
   * waits for the next push, then delete its resources and tear it down.
   */
  | {
      kind: "remove";
      pr: number;
      reason: "evicted" | "idle";
      description: string;
      project: DockerProject;
      /** The PR's Deployment at the project's SHA, or undefined when none was read. */
      deploymentId: number | undefined;
      resourceIds: number[];
    }
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

export type OwnedResource = { pr: number; resourceId: number; orphan: boolean };

/**
 * The resources the agent owns: exactly a Preview's host name, and either a
 * target on the Previews site, or no targets at all and the agent's name for
 * it, `banki-pr-<N>`. That last kind is an orphan: the agent created it but
 * was cut short before its target. Pangolin's own search is a substring
 * match, so it is never trusted; every other resource is left alone.
 */
export function ownedResources(resources: PangolinResource[], siteId: number): OwnedResource[] {
  return resources.flatMap((resource): OwnedResource[] => {
    const pr = prFromHost(resource.fullDomain);
    if (pr === undefined) return [];
    if (resource.siteIds.includes(siteId)) {
      return [{ pr, resourceId: resource.resourceId, orphan: false }];
    }
    if (!resource.hasTargets && resource.name === projectName(pr)) {
      return [{ pr, resourceId: resource.resourceId, orphan: true }];
    }
    return [];
  });
}

export function plan(input: PlanInput): Action[] {
  const targets = new Map(
    input.pullRequests.filter(isTarget).map((pull) => [pull.number, pull] as const),
  );
  const projectOf = new Map(input.projects.map((project) => [project.pr, project] as const));
  const owned = ownedResources(input.resources, input.siteId);

  // An open PR's Preview goes once it has gone idle, whatever its state. One
  // whose Deployment already says it was evicted or went idle is torn down
  // again, so a removal cut off halfway gets finished.
  const finishing: DockerProject[] = [];
  const idle: Extract<Action, { kind: "remove" }>[] = [];
  for (const project of input.projects) {
    if (!targets.has(project.pr)) continue;
    if (isRemoved(madeBy(input.deployments, project))) {
      finishing.push(project);
    } else if (isIdle(project, input)) {
      idle.push(removal(input, owned, project, "idle"));
    }
  }
  const markedNow = new Set(idle.map((action) => action.deploymentId));

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
  const confirms: Extract<Action, { kind: "confirm" }>[] = [];
  const deploys: Extract<Action, { kind: "deploy" }>[] = [];
  for (const pull of targets.values()) {
    const head = headDeployment(input.deployments, pull);
    const others = input.deployments.filter(
      (deployment) =>
        deployment.pr === pull.number &&
        deployment.id !== head?.id &&
        deployment.status !== "inactive",
    );
    // An inactive head is a PR reopened at the commit it closed on, unless its
    // Preview was evicted or went idle: that waits for the next push, closed
    // and reopened or not, or it would come straight back.
    if (head === undefined || (head.status === "inactive" && !isRemoved(head))) {
      createDeployments.push({ kind: "create-deployment", pr: pull.number, sha: pull.headSha });
      continue;
    }
    // Its Preview goes idle in this plan, so the head waits for the next push too.
    if (markedNow.has(head.id)) continue;
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
    // Already running at the head: a deploy got that far, but its success was
    // never recorded. Taking a healthy Preview down again would repeat every
    // loop for as long as GitHub refuses the write.
    const project = projectOf.get(pull.number);
    if (
      project !== undefined &&
      project.sha === pull.headSha &&
      project.api === "running" &&
      project.web === "running"
    ) {
      confirms.push({
        kind: "confirm",
        pr: pull.number,
        sha: pull.headSha,
        deploymentId: head.id,
        project,
        supersedes: others.map((deployment) => deployment.id),
      });
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
    // Queued, or in progress when the agent stopped mid-deploy (one action runs
    // at a time, so the planner never sees a deploy that is still going), and
    // nothing runs at the head: from scratch.
    deploys.push({
      kind: "deploy",
      pr: pull.number,
      sha: pull.headSha,
      deploymentId: head.id,
      digests: images.digests,
      previous: project,
      supersedes: others.map((deployment) => deployment.id),
      deployedAt: input.now,
    });
  }

  // A deploy admits one more running Preview. Right before it, as many of the
  // running ones as the cap needs make room, oldest last deploy first; the
  // PR's own counts for nothing, since the deploy replaces it. A PR with a
  // deploy of its own in this plan goes only when nothing else can: it is
  // about to be replaced anyway, but two such PRs must not wait on each other.
  // Each deploy counts the ones before it as done, the newest of all, though
  // the loop stops after the first: the next loop plans the rest again.
  const leaving = new Set([...finishing, ...idle.map((action) => action.project)]);
  const redeploying = new Set(deploys.map((action) => action.pr));
  const deploysMakingRoom: Action[] = [];
  const evictions: Extract<Action, { kind: "remove" }>[] = [];
  let running = input.projects
    .filter((project) => targets.has(project.pr) && isRunning(project) && !leaving.has(project))
    .toSorted(byLastDeploy);
  for (const action of deploys) {
    const others = running.filter((project) => project.pr !== action.pr);
    const excess = Math.max(0, others.length + 1 - input.limits.cap);
    const evicted = [
      ...others.filter((project) => !redeploying.has(project.pr)),
      ...others.filter((project) => redeploying.has(project.pr)),
    ].slice(0, excess);
    for (const project of evicted) {
      const eviction = removal(input, owned, project, "evicted");
      evictions.push(eviction);
      deploysMakingRoom.push(eviction);
    }
    deploysMakingRoom.push(action);
    running = [...others.filter((project) => !evicted.includes(project)), deployed(action)];
  }

  // A resource exists exactly while its PR is an open target, its `web` runs
  // and its Preview isn't being removed. A removal deletes its PR's resources
  // itself, after marking the Deployment.
  const removing = new Set([...idle, ...evictions].map((action) => action.pr));
  const gone = new Set([...finishing.map((project) => project.pr), ...removing]);
  const wantsResource = (pr: number) =>
    targets.has(pr) && projectOf.get(pr)?.web === "running" && !gone.has(pr);

  // An orphan routes nowhere and holds its host, so it always goes, and a
  // wanted PR gets a whole resource again below.
  const deleteResources: Action[] = owned
    .filter(
      (resource) => (resource.orphan || !wantsResource(resource.pr)) && !removing.has(resource.pr),
    )
    .map((resource) => ({
      kind: "delete-resource",
      pr: resource.pr,
      resourceId: resource.resourceId,
    }));

  const teardowns: Action[] = [
    ...input.projects.filter((project) => !targets.has(project.pr)),
    ...finishing,
  ].map((project) => ({ kind: "teardown", project }));

  // A deploy or a confirm ends by creating or keeping the resource itself.
  const deploying = new Set([...deploys, ...confirms].map((action) => action.pr));
  const createResources: Action[] = [...targets.keys()]
    .filter(
      (pr) =>
        wantsResource(pr) &&
        !deploying.has(pr) &&
        !owned.some((resource) => resource.pr === pr && !resource.orphan),
    )
    .map((pr) => ({ kind: "create-resource", pr }));

  return [
    ...deleteResources,
    ...teardowns,
    ...idle,
    ...closedDeployments,
    ...supersededDeployments,
    ...createResources,
    ...createDeployments,
    ...markQueued,
    ...confirms,
    ...deploysMakingRoom,
  ];
}

/**
 * Whether the Preview counts against the cap: one of its services runs. A
 * failed one (stopped), one stopped by hand, and a leftover volume don't.
 */
export const isRunning = (project: DockerProject) =>
  project.api === "running" || project.web === "running";

/** Oldest last deploy first, a missing label oldest of all; a tie goes to the lower PR. */
const byLastDeploy = (a: DockerProject, b: DockerProject) =>
  (a.deployedAt?.getTime() ?? -Infinity) - (b.deployedAt?.getTime() ?? -Infinity) || a.pr - b.pr;

/** Whether the Preview's last deploy is at least the idle limit ago; only the label counts. */
const isIdle = (project: DockerProject, input: PlanInput) =>
  project.deployedAt !== undefined &&
  input.now.getTime() - project.deployedAt.getTime() >= input.limits.idleDays * DAY_MS;

const DAY_MS = 86_400_000;

/** The project a deploy leaves running, if it succeeds. */
const deployed = (action: Extract<Action, { kind: "deploy" }>): DockerProject => ({
  pr: action.pr,
  sha: action.sha,
  deployedAt: action.deployedAt,
  digests: action.digests,
  api: "running",
  web: "running",
});

/** Removing the project of an open PR: its Deployment marked first, then its resources and itself. */
function removal(
  input: PlanInput,
  owned: OwnedResource[],
  project: DockerProject,
  reason: "evicted" | "idle",
): Extract<Action, { kind: "remove" }> {
  const made = madeBy(input.deployments, project);
  // A head still waiting deploys anyway, over whatever is left: an eviction
  // marking it would keep a fresh push down. An idle one is marked, though.
  const pull = input.pullRequests.find((candidate) => candidate.number === project.pr);
  const waitingHead =
    made !== undefined &&
    pull !== undefined &&
    made.id === headDeployment(input.deployments, pull)?.id &&
    isWaiting(made);
  return {
    kind: "remove",
    pr: project.pr,
    reason,
    description: removedDescription(reason, input.limits.idleDays),
    project,
    deploymentId: reason === "evicted" && waitingHead ? undefined : made?.id,
    resourceIds: owned
      .filter((resource) => resource.pr === project.pr)
      .map((resource) => resource.resourceId),
  };
}

/** The Deployment that made the project: the newest of its PR at its SHA. */
const madeBy = (deployments: Deployment[], project: DockerProject) =>
  project.sha === undefined
    ? undefined
    : newestFirst(
        deployments.filter(
          (deployment) => deployment.pr === project.pr && deployment.sha === project.sha,
        ),
      )[0];

/** Whether the Deployment went inactive because its Preview was evicted or went idle. */
const isRemoved = (deployment: Deployment | undefined) =>
  deployment?.status === "inactive" && deployment.description?.endsWith(PUSH_TO_REBUILD) === true;

/** The description of a Deployment whose Preview was evicted or went idle. */
const removedDescription = (reason: "evicted" | "idle", idleDays: number) =>
  reason === "evicted"
    ? `evicted${PUSH_TO_REBUILD}`
    : `idle for ${idleDays} day${idleDays === 1 ? "" : "s"}${PUSH_TO_REBUILD}`;

const PUSH_TO_REBUILD = ", push to rebuild";

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

/**
 * Whether the loop, reading the `preview` Deployments newest first, has read
 * enough to plan, so it can stop paging: every target's head has a
 * Deployment among those read, and the page just read (`lastPage`) holds only
 * inactive ones. Without it, every loop would read every Deployment ever made.
 *
 * It is a shortcut, not proof: an older page can still hold a Deployment that
 * isn't inactive, such as the success of a PR that closes after a long idle,
 * or an older one it superseded. {@link isFullReadLoop} loops read them all.
 */
export function readEnoughDeployments(
  pullRequests: PullRequest[],
  read: Deployment[],
  lastPage: Deployment[],
): boolean {
  return (
    pullRequests
      .filter(isTarget)
      .every((pull) =>
        read.some((deployment) => deployment.pr === pull.number && deployment.sha === pull.headSha),
      ) && lastPage.every((deployment) => deployment.status === "inactive")
  );
}

/** Every how many loops the agent reads every Deployment, whatever the shortcut says. */
export const FULL_READ_EVERY = 20;

/**
 * Whether loop number `loop` (0 is the agent's first) reads every `preview`
 * Deployment instead of stopping at {@link readEnoughDeployments}: the first,
 * then every 20th, about every 10 minutes. So a Deployment deep in history
 * that isn't inactive yet still gets marked, at the latest 10 minutes late.
 */
export const isFullReadLoop = (loop: number) => loop % FULL_READ_EVERY === 0;
