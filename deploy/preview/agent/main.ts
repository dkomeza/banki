import { type AnyAction, NO_PLAN, orderPlans, orSkip, type Pool, runActions } from "./act";
import * as clone from "./clone";
import {
  ConfigError,
  pangolinSettings,
  PR_PREVIEW_RESOURCES,
  previewLimits,
  readSecret,
  SECRETS,
  type ServiceResources,
  slugPreviewLimits,
} from "./config";
import { confirm, deploy, type Services } from "./deploy";
import * as docker from "./docker";
import { resolveDigests } from "./ghcr";
import { gitHub, type GitHub } from "./github";
import { HELPER, removeFinishedHelper, runHelper, START_WAIT_MS } from "./helper";
import { keyOf, type PreviewKey, projectName, REPO, shortSha, SLUG_ENVIRONMENT } from "./naming";
import { type Pangolin, pangolin } from "./pangolin";
import {
  type Action,
  type DockerProject,
  type ImagesReady,
  imagesToCheck,
  isFullReadLoop,
  type Limits,
  type PlanParts,
  planParts,
} from "./planner";
import { isCommit, updateDecision } from "./self-update";
import {
  planSlugParts,
  type SlugAction,
  type SlugImagesReady,
  type SlugLimits,
  type SlugProject,
  slugImagesToCheck,
} from "./slug-planner";

// The pull agent (ADR-0008, ADR-0011): every 30 s it first moves itself onto
// `main` when its own code changed there (ADR-0009), then observes the open
// PRs, the Docker projects, the `preview` and `slug-preview` Deployments, the
// images and the Pangolin resources, asks each pool's planner what to do, and
// does it, one action at a time.

const SLEEP_MS = 30_000;

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

type Settings = {
  previews: Pangolin;
  limits: Limits;
  slugLimits: SlugLimits & { resources: ServiceResources };
};

async function start(): Promise<Settings> {
  try {
    const limits = previewLimits();
    const slugLimits = slugPreviewLimits();
    const previews = await pangolin({
      ...pangolinSettings(),
      apiKey: readSecret(SECRETS.pangolinApiKey),
    });
    console.log(`Watching ${REPO}, routing Previews through Pangolin site ${previews.siteId}`);
    console.log(
      `At most ${limits.cap} PR Previews run at once, and each is removed ${limits.idleDays} days after its last deploy`,
    );
    const { apiMemory, apiCpus, webMemory, webCpus } = slugLimits.resources;
    console.log(
      `At most ${slugLimits.cap} Slug Previews run at once, each with api ${apiMemory} / ${apiCpus} CPU and web ${webMemory} / ${webCpus} CPU`,
    );
    // The helper whose `up` started this agent may still be finishing it.
    const leftover = await removeFinishedHelper(START_WAIT_MS).catch((error: unknown) => {
      console.error(`Couldn't remove the old ${HELPER}: ${errorText(error)}`);
    });
    if (leftover === "running") {
      console.error(
        `${HELPER} is still running after ${START_WAIT_MS / 60_000} minutes: leaving it, to be removed on the next start`,
      );
    }
    return { previews, limits, slugLimits };
  } catch (error) {
    console.error(`Can't start: ${errorText(error)}`);
    return process.exit(1);
  }
}

/** The `main` commits whose self-update failed, tried again only after a restart. */
const failedUpdates = new Set<string>();

/**
 * Rebuilds and restarts the agent from its own clone of `main` when anything
 * under deploy/preview/ differs from the commit it runs (ADR-0009). It blocks
 * the loop like any action; on success the new agent replaces this one in the
 * middle of it.
 */
async function keepCurrent(): Promise<void> {
  let main: string;
  try {
    main = await clone.fetchMain();
  } catch (error) {
    console.error(`Self-update: couldn't fetch main, trying again next loop: ${errorText(error)}`);
    return;
  }
  // Empty for an agent a person started; the helper sets it to what it builds.
  const running = process.env.BANKI_PREVIEW_COMMIT?.trim() ?? "";
  const decision = updateDecision({
    running,
    main,
    changedPaths: isCommit(running) ? await clone.changedPaths(running, main) : undefined,
    failed: failedUpdates,
  });
  if (decision.kind !== "update") return;

  const target = `main ${shortSha(main)}`;
  console.log(`Self-update: rebuilding on ${target}, since ${decision.why}`);
  failedUpdates.add(main);
  try {
    const exitCode = await runHelper(main, process.env.BANKI_PREVIEW_SECRETS ?? "");
    console.error(
      exitCode === 0
        ? `Self-update to ${target}: the helper finished, but didn't replace this agent. Keeping it, and not trying ${target} again`
        : `Self-update to ${target} failed: the helper exited ${exitCode}. Keeping this agent, and not trying ${target} again`,
    );
  } catch (error) {
    console.error(
      `Self-update to ${target} failed: ${errorText(error)}. Keeping this agent, and not trying ${target} again`,
    );
  }
}

/**
 * Which pool's deploy goes first when both have one waiting. Only fairness
 * hangs on it, so losing it to a restart loses nothing that matters.
 */
let turn: Pool = "pr";

async function reconcile(settings: Settings, loop: number): Promise<void> {
  const { previews, limits, slugLimits } = settings;
  // Read on every loop, so a token `bootstrap` rewrites applies without a restart.
  const github = gitHub(readSecret(SECRETS.githubToken));
  // The Deployments are read only as far back as the open PRs and the Docker
  // projects need, so Docker comes first (it is local and quick). Docker and
  // Pangolin serve both pools, so failing them fails the loop; each pool's
  // own GitHub reads fail only that pool, which then waits, untouched.
  const projects = await docker.discoverProjects();
  const full = isFullReadLoop(loop);
  const [prRead, slugDeployments, resources] = await Promise.all([
    orSkip("PR Previews", async () => {
      const pullRequests = await github.openPullRequests();
      const deployments = await github.previewDeployments(pullRequests, projects.prs, { full });
      return { pullRequests, deployments };
    }),
    orSkip("Slug Previews", () => github.slugPreviewDeployments(projects.slugs, { full })),
    previews.resources(),
  ]);
  const now = new Date();
  const shared = { resources, siteId: previews.siteId, now };

  let prPlan: PlanParts<Action> = NO_PLAN;
  if (prRead !== undefined) {
    const observed = { ...prRead, ...shared, projects: projects.prs, limits };
    const images: ImagesReady[] = [];
    for (const { pr, sha } of imagesToCheck(observed)) {
      const digests = await lookUp(pr, sha);
      if (digests !== undefined) images.push({ pr, sha, digests });
    }
    prPlan = planParts({ ...observed, images });
  }

  let slugPlan: PlanParts<SlugAction> = NO_PLAN;
  if (slugDeployments !== undefined) {
    const observed = {
      ...shared,
      deployments: slugDeployments,
      projects: projects.slugs,
      limits: { cap: slugLimits.cap },
    };
    const images: SlugImagesReady[] = [];
    for (const { slug, sha } of slugImagesToCheck(observed)) {
      const digests = await lookUp(slug, sha);
      if (digests !== undefined) images.push({ slug, sha, digests });
    }
    slugPlan = planSlugParts({ ...observed, images });
  }

  const ordered = orderPlans(prPlan, slugPlan, turn);
  turn = ordered.turn;
  const resourcesFor = (key: PreviewKey) =>
    typeof key === "number" ? PR_PREVIEW_RESOURCES : slugLimits.resources;
  const context = { github, previews, now, resourcesFor };
  await runActions(ordered.actions, summary, (action) =>
    isSlugAction(action) ? executeSlug(action, context) : execute(action, context),
  );
}

/** One Preview's lookup failing leaves only that Preview waiting, not every other. */
async function lookUp(key: PreviewKey, sha: string) {
  try {
    return await resolveDigests(key, sha);
  } catch (error) {
    console.error(
      `${projectName(key)}: couldn't look up the images of ${shortSha(sha)}, so they count as not ready: ${errorText(error)}`,
    );
    return undefined;
  }
}

type Context = {
  github: GitHub;
  previews: Pangolin;
  now: Date;
  resourcesFor: (key: PreviewKey) => ServiceResources;
};

const isSlugAction = (action: AnyAction): action is SlugAction => "pool" in action;

async function execute(action: Action, context: Context) {
  const { github, previews } = context;
  switch (action.kind) {
    case "create-deployment": {
      const id = await github.createDeployment(action.pr, action.sha);
      await github.setStatus(id, "queued", `waiting for images of ${shortSha(action.sha)}`);
      return;
    }
    case "mark-queued":
      return github.setStatus(
        action.deploymentId,
        "queued",
        `waiting for images of ${shortSha(action.sha)}`,
      );
    case "deploy":
      return deploy(action, services(context));
    case "confirm":
      return confirm(action, services(context));
    case "teardown":
      return teardown(action.project, context);
    case "remove": {
      // Marked first: should the rest fail, the next loop sees the mark and
      // finishes the teardown, and the head waits for the next push.
      if (action.deploymentId !== undefined) {
        await github.setStatus(action.deploymentId, "inactive", action.description);
      }
      for (const resourceId of action.resourceIds) await previews.deleteResource(resourceId);
      return teardown(action.project, context);
    }
    case "mark-inactive":
      return github.setStatus(
        action.deploymentId,
        "inactive",
        action.reason === "closed" ? "PR closed" : "superseded by a newer deploy",
      );
    case "create-resource":
      return previews.createOrKeep(action.pr);
    case "delete-resource":
      return previews.deleteResource(action.resourceId);
  }
}

async function executeSlug(action: SlugAction, context: Context) {
  const { github, previews } = context;
  switch (action.kind) {
    case "mark-queued":
      return github.setStatus(
        action.deploymentId,
        "queued",
        `waiting for images of ${shortSha(action.sha)}`,
      );
    case "deploy":
      return deploy(action, services(context));
    case "confirm":
      return confirm(action, services(context));
    case "teardown":
      return teardown(action.project, context);
    case "remove": {
      // Marked first, as a PR Preview's: should the rest fail, the next loop
      // sees it inactive and finishes the teardown, and it stays down.
      if (action.deploymentId !== undefined) {
        await github.setStatus(action.deploymentId, "inactive", action.description);
      }
      for (const resourceId of action.resourceIds) await previews.deleteResource(resourceId);
      if (action.project !== undefined) await teardown(action.project, context);
      return;
    }
    case "mark-inactive":
      return github.setStatus(action.deploymentId, "inactive", "superseded by a newer deploy");
    case "mark-invalid":
      return github.setStatus(action.deploymentId, "failure", "invalid slug");
    case "create-resource":
      return previews.createOrKeep(action.slug);
    case "delete-resource":
      return previews.deleteResource(action.resourceId);
  }
}

async function teardown(project: DockerProject | SlugProject, context: Context): Promise<void> {
  const target = docker.targetOf(project, context.now, context.resourcesFor(keyOf(project)));
  const result = await docker.down(target);
  if (result.exitCode !== 0) throw new Error(`down ${docker.failure(result)}`);
}

const services = ({ github, previews, resourcesFor }: Context): Services => ({
  github,
  pangolin: previews,
  docker,
  resourcesFor,
  readSecret,
  sleep: (ms) => Bun.sleep(ms),
});

function summary(action: AnyAction): string {
  if (action.kind === "mark-invalid") {
    return `${SLUG_ENVIRONMENT} deployment ${action.deploymentId}: mark-invalid`;
  }
  const project = projectName(action.kind === "teardown" ? keyOf(action.project) : keyOf(action));
  if (action.kind === "remove") return `${project}: remove (${action.reason})`;
  if (action.kind === "mark-inactive") {
    return `${project}: mark-inactive deployment ${action.deploymentId} (${action.reason})`;
  }
  if (action.kind === "delete-resource") {
    return `${project}: delete-resource ${action.resourceId}`;
  }
  if ("sha" in action) return `${project}: ${action.kind} ${shortSha(action.sha)}`;
  return `${project}: ${action.kind}`;
}

const settings = await start();
for (let loop = 0; ; loop++) {
  // A failed update is logged and leaves this agent running: the Previews
  // are reconciled regardless.
  await keepCurrent().catch((error: unknown) => {
    console.error(`Self-update failed: ${errorText(error)}`);
  });
  try {
    await reconcile(settings, loop);
  } catch (error) {
    console.error(`Loop failed: ${errorText(error)}`);
    if (error instanceof ConfigError) process.exit(1);
  }
  await Bun.sleep(SLEEP_MS);
}
