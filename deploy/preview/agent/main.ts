import * as clone from "./clone";
import { ConfigError, pangolinSettings, previewLimits, readSecret, SECRETS } from "./config";
import { confirm, deploy, type Services } from "./deploy";
import * as docker from "./docker";
import { resolveDigests } from "./ghcr";
import { gitHub, type GitHub } from "./github";
import { HELPER, removeHelper, runHelper } from "./helper";
import { projectName, REPO, shortSha } from "./naming";
import { type Pangolin, pangolin } from "./pangolin";
import {
  type Action,
  type DockerProject,
  type ImagesReady,
  imagesToCheck,
  isFullReadLoop,
  type Limits,
  plan,
} from "./planner";
import { isCommit, updateDecision } from "./self-update";

// The pull agent (ADR-0008): every 30 s it first moves itself onto `main` when
// its own code changed there (ADR-0009), then observes the open PRs, the
// Docker projects, the `preview` Deployments, the images and the Pangolin
// resources, asks the planner what to do, and does it, one action at a time.

const SLEEP_MS = 30_000;

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

async function start(): Promise<{ previews: Pangolin; limits: Limits }> {
  try {
    const limits = previewLimits();
    const previews = await pangolin({
      ...pangolinSettings(),
      apiKey: readSecret(SECRETS.pangolinApiKey),
    });
    console.log(`Watching ${REPO}, routing Previews through Pangolin site ${previews.siteId}`);
    console.log(
      `At most ${limits.cap} Previews run at once, and each is removed ${limits.idleDays} days after its last deploy`,
    );
    // Whatever update started this agent is over, or failed.
    await removeHelper().catch((error: unknown) => {
      console.error(`Couldn't remove the old ${HELPER}: ${errorText(error)}`);
    });
    return { previews, limits };
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

async function reconcile(previews: Pangolin, limits: Limits, loop: number): Promise<void> {
  // Read on every loop, so a token `bootstrap` rewrites applies without a restart.
  const github = gitHub(readSecret(SECRETS.githubToken));
  // The Deployments are read only as far back as the open PRs need.
  const pullRequests = await github.openPullRequests();
  const [deployments, projects, resources] = await Promise.all([
    github.previewDeployments(pullRequests, { full: isFullReadLoop(loop) }),
    docker.discoverProjects(),
    previews.resources(),
  ]);
  const observed = {
    pullRequests,
    deployments,
    projects,
    resources,
    siteId: previews.siteId,
    limits,
    now: new Date(),
  };

  const images: ImagesReady[] = [];
  for (const { pr, sha } of imagesToCheck(observed)) {
    // One PR's lookup failing leaves only that PR waiting, not every other.
    try {
      const digests = await resolveDigests(pr, sha);
      if (digests !== undefined) images.push({ pr, sha, digests });
    } catch (error) {
      console.error(
        `${projectName(pr)}: couldn't look up the images of ${shortSha(sha)}, so they count as not ready: ${errorText(error)}`,
      );
    }
  }

  for (const action of plan({ ...observed, images })) {
    console.log(summary(action));
    try {
      await execute(action, github, previews, observed.now);
    } catch (error) {
      // The next loop observes again and retries whatever is still wrong.
      console.error(`${summary(action)} failed: ${errorText(error)}`);
    }
    // A deploy takes a while, and what it was planned from may have moved on.
    if (action.kind === "deploy") break;
  }
}

async function execute(action: Action, github: GitHub, previews: Pangolin, now: Date) {
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
      return deploy(action, services(github, previews));
    case "confirm":
      return confirm(action, services(github, previews));
    case "teardown":
      return teardown(action.project, now);
    case "remove": {
      // Marked first: should the rest fail, the next loop sees the mark and
      // finishes the teardown, and the head waits for the next push.
      if (action.deploymentId !== undefined) {
        await github.setStatus(action.deploymentId, "inactive", action.description);
      }
      for (const resourceId of action.resourceIds) await previews.deleteResource(resourceId);
      return teardown(action.project, now);
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

async function teardown(project: DockerProject, now: Date): Promise<void> {
  const result = await docker.down(docker.targetOf(project, now));
  if (result.exitCode !== 0) throw new Error(`down ${docker.failure(result)}`);
}

const services = (github: GitHub, previews: Pangolin): Services => ({
  github,
  pangolin: previews,
  docker,
  readSecret,
  sleep: (ms) => Bun.sleep(ms),
});

function summary(action: Action): string {
  const project = projectName(action.kind === "teardown" ? action.project.pr : action.pr);
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

const { previews, limits } = await start();
for (let loop = 0; ; loop++) {
  // A failed update is logged and leaves this agent running: the Previews
  // are reconciled regardless.
  await keepCurrent().catch((error: unknown) => {
    console.error(`Self-update failed: ${errorText(error)}`);
  });
  try {
    await reconcile(previews, limits, loop);
  } catch (error) {
    console.error(`Loop failed: ${errorText(error)}`);
    if (error instanceof ConfigError) process.exit(1);
  }
  await Bun.sleep(SLEEP_MS);
}
