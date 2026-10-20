import { ConfigError, pangolinSettings, readSecret, SECRETS } from "./config";
import { confirm, deploy } from "./deploy";
import * as docker from "./docker";
import { resolveDigests } from "./ghcr";
import { gitHub, type GitHub } from "./github";
import { projectName, REPO, shortSha } from "./naming";
import { type Pangolin, pangolin } from "./pangolin";
import { type Action, type ImagesReady, imagesToCheck, plan } from "./planner";

// The pull agent (ADR-0008): every 30 s it observes the open PRs, the Docker
// projects, the `preview` Deployments, the images and the Pangolin resources,
// asks the planner what to do, and does it, one action at a time.

const SLEEP_MS = 30_000;

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

async function start(): Promise<Pangolin> {
  try {
    const previews = await pangolin({
      ...pangolinSettings(),
      apiKey: readSecret(SECRETS.pangolinApiKey),
    });
    console.log(`Watching ${REPO}, routing Previews through Pangolin site ${previews.siteId}`);
    return previews;
  } catch (error) {
    console.error(`Can't start: ${errorText(error)}`);
    return process.exit(1);
  }
}

async function reconcile(previews: Pangolin): Promise<void> {
  // Read on every loop, so a token `bootstrap` rewrites applies without a restart.
  const github = gitHub(readSecret(SECRETS.githubToken));
  // The Deployments are read only as far back as the open PRs need.
  const pullRequests = await github.openPullRequests();
  const [deployments, projects, resources] = await Promise.all([
    github.previewDeployments(pullRequests),
    docker.discoverProjects(),
    previews.resources(),
  ]);
  const observed = {
    pullRequests,
    deployments,
    projects,
    resources,
    siteId: previews.siteId,
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
      return deploy(action, { github, pangolin: previews });
    case "confirm":
      return confirm(action, { github, pangolin: previews });
    case "teardown": {
      const result = await docker.down(docker.targetOf(action.project, now));
      if (result.exitCode !== 0) throw new Error(`down ${docker.failure(result)}`);
      return;
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

function summary(action: Action): string {
  const project = projectName(action.kind === "teardown" ? action.project.pr : action.pr);
  if (action.kind === "mark-inactive") {
    return `${project}: mark-inactive deployment ${action.deploymentId} (${action.reason})`;
  }
  if (action.kind === "delete-resource") {
    return `${project}: delete-resource ${action.resourceId}`;
  }
  if ("sha" in action) return `${project}: ${action.kind} ${shortSha(action.sha)}`;
  return `${project}: ${action.kind}`;
}

const previews = await start();
for (;;) {
  try {
    await reconcile(previews);
  } catch (error) {
    console.error(`Loop failed: ${errorText(error)}`);
    if (error instanceof ConfigError) process.exit(1);
  }
  await Bun.sleep(SLEEP_MS);
}
