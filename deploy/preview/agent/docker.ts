import { join } from "node:path";
import { LABELS, prFromProjectName, projectName } from "./naming";
import type { DockerProject, ImageDigests, ServiceState } from "./planner";
import { run, type RunOptions, type RunResult } from "./run";

// The Docker adapter: finds the Previews' Compose projects and runs the
// template's `docker compose` commands against the host's daemon, through the
// socket the agent holds.

/** The Preview template, baked into the agent's image beside its code. */
const TEMPLATE = join(import.meta.dir, "..", "compose.yaml");

const COMPOSE_PROJECT = "com.docker.compose.project";

// Every object prints its project and the Preview labels; a container adds its
// service, whether it is a one-off (`docker compose run`) and its state.
const LABEL_FIELDS = [
  COMPOSE_PROJECT,
  LABELS.sha,
  LABELS.deployedAt,
  LABELS.apiDigest,
  LABELS.webDigest,
];
const LABELS_FORMAT = LABEL_FIELDS.map((label) => `{{.Label "${label}"}}`).join("\t");
const CONTAINER_FORMAT = `${LABELS_FORMAT}\t{{.Label "com.docker.compose.service"}}\t{{.Label "com.docker.compose.oneoff"}}\t{{.State}}`;

const LIST_TIMEOUT_MS = 30_000;

/** Every `banki-pr-<N>` project, found from any of its containers, volumes or networks. */
export async function discoverProjects(): Promise<DockerProject[]> {
  const filter = ["--filter", `label=${COMPOSE_PROJECT}`];
  const [containers, volumes, networks] = await Promise.all([
    list(["docker", "ps", "--all", ...filter, "--format", CONTAINER_FORMAT]),
    list(["docker", "volume", "ls", ...filter, "--format", LABELS_FORMAT]),
    list(["docker", "network", "ls", ...filter, "--format", LABELS_FORMAT]),
  ]);
  return projectsFrom({ containers, volumes, networks });
}

async function list(argv: string[]): Promise<string> {
  const result = await run(argv, { timeoutMs: LIST_TIMEOUT_MS });
  if (result.exitCode !== 0) {
    throw new Error(`${argv.slice(0, 3).join(" ")} failed: ${failure(result)}`);
  }
  return result.stdout;
}

type DockerObject = {
  pr: number;
  labels: string[];
  /** For a service container: its service and state. */
  service?: { name: string; state: ServiceState };
};

/** Groups the listed objects into projects. Pure, so it is unit-tested. */
export function projectsFrom(listed: {
  containers: string;
  volumes: string;
  networks: string;
}): DockerProject[] {
  const containers = lines(listed.containers).flatMap((line): DockerObject[] => {
    const object = parseObject(line);
    if (object === undefined) return [];
    const [name = "", oneoff = "", state = ""] = line.split("\t").slice(LABEL_FIELDS.length);
    if (oneoff === "True") return [object];
    return [{ ...object, service: { name, state: state === "running" ? "running" : "stopped" } }];
  });
  const others = [...lines(listed.volumes), ...lines(listed.networks)].flatMap(
    (line) => parseObject(line) ?? [],
  );
  // Service containers first, so their labels win: they are the deploy that ran.
  const objects = [
    ...containers.filter((object) => object.service !== undefined),
    ...containers.filter((object) => object.service === undefined),
    ...others,
  ];

  const prs = [...new Set(objects.map((object) => object.pr))].toSorted((a, b) => a - b);
  return prs.map((pr) => {
    const found = objects.filter((object) => object.pr === pr);
    const label = (index: number) =>
      found
        .map((object) => object.labels[index])
        .find((value) => value !== undefined && value !== "");
    const state = (service: string): ServiceState =>
      found.find((object) => object.service?.name === service)?.service?.state ?? "missing";
    const [sha, deployedAt, api, web] = [label(0), label(1), label(2), label(3)];
    return {
      pr,
      sha,
      deployedAt:
        deployedAt === undefined || Number.isNaN(Date.parse(deployedAt))
          ? undefined
          : new Date(deployedAt),
      digests: api !== undefined && web !== undefined ? { api, web } : undefined,
      api: state("api"),
      web: state("web"),
    };
  });
}

const lines = (text: string) => text.split("\n").filter((line) => line.trim() !== "");

function parseObject(line: string): DockerObject | undefined {
  const [project = "", ...labels] = line.split("\t");
  const pr = prFromProjectName(project);
  return pr === undefined ? undefined : { pr, labels: labels.slice(0, LABEL_FIELDS.length - 1) };
}

/** What the template needs to render: the PR, its commit, the images, and when. */
export type ComposeTarget = { pr: number; sha: string; deployedAt: Date; digests: ImageDigests };

// Stands in for what a project's labels don't say, so the template still
// renders for a `down`. No image has this digest, so `--rmi all` skips it.
const NO_DIGEST = `sha256:${"0".repeat(64)}`;
export const NO_DIGESTS: ImageDigests = { api: NO_DIGEST, web: NO_DIGEST };

/** The target to take `project` down with: the images it was deployed from, when known. */
export function targetOf(project: DockerProject, now: Date): ComposeTarget {
  return {
    pr: project.pr,
    sha: project.sha ?? "unknown",
    deployedAt: project.deployedAt ?? now,
    digests: project.digests ?? NO_DIGESTS,
  };
}

function compose(target: ComposeTarget, args: string[], options: RunOptions): Promise<RunResult> {
  return run(
    ["docker", "compose", "--project-name", projectName(target.pr), "--file", TEMPLATE, ...args],
    {
      ...options,
      env: {
        PREVIEW_PR: String(target.pr),
        PREVIEW_SHA: target.sha,
        PREVIEW_DEPLOYED_AT: target.deployedAt.toISOString(),
        API_DIGEST: target.digests.api,
        WEB_DIGEST: target.digests.web,
        ...options.env,
      },
    },
  );
}

/** Removes the project's containers (one-offs included), volumes, networks and images. */
export const down = (target: ComposeTarget) =>
  compose(target, ["down", "--volumes", "--remove-orphans", "--rmi", "all"], {
    timeoutMs: 180_000,
    logAs: `${projectName(target.pr)} down`,
  });

export const pull = (target: ComposeTarget) =>
  compose(target, ["pull", "--quiet"], {
    timeoutMs: 600_000,
    logAs: `${projectName(target.pr)} pull`,
  });

/**
 * `banki setup` against the fresh volume. The Password goes in on stdin only,
 * never in argv or an environment; the command never prints it.
 */
export const setup = (target: ComposeTarget, email: string, password: string) =>
  compose(
    target,
    [
      "run",
      "--rm",
      "-T",
      "api",
      "bun",
      "run",
      "banki",
      "setup",
      "--email",
      email,
      "--password-stdin",
    ],
    { timeoutMs: 120_000, stdin: `${password}\n`, logAs: `${projectName(target.pr)} setup` },
  );

export const seed = (target: ComposeTarget) =>
  compose(target, ["run", "--rm", "-T", "api", "bun", "run", "banki", "seed"], {
    timeoutMs: 120_000,
    logAs: `${projectName(target.pr)} seed`,
  });

export const UP_WAIT_SECONDS = 60;

export const up = (target: ComposeTarget) =>
  compose(target, ["up", "--detach", "--wait", "--wait-timeout", String(UP_WAIT_SECONDS)], {
    timeoutMs: (UP_WAIT_SECONDS + 60) * 1000,
    logAs: `${projectName(target.pr)} up`,
  });

/** Each service's state and health (empty for `web`, which has no healthcheck). */
export async function serviceStates(
  target: ComposeTarget,
): Promise<{ service: string; state: string; health: string }[]> {
  const result = await compose(
    target,
    ["ps", "--all", "--format", "{{.Service}}\t{{.State}}\t{{.Health}}"],
    { timeoutMs: LIST_TIMEOUT_MS },
  );
  return lines(result.stdout).map((line) => {
    const [service = "", state = "", health = ""] = line.split("\t");
    return { service, state, health };
  });
}

/**
 * `/api/health` from inside `web` (busybox wget), so it checks the whole path
 * through Caddy to the API without the agent joining `banki-previews`.
 */
export const health = (target: ComposeTarget) =>
  compose(target, ["exec", "-T", "web", "wget", "-qO-", "http://localhost:8080/api/health"], {
    timeoutMs: 30_000,
  });

/**
 * Leaves a failed Preview stopped: its service containers, and any one-off
 * container a timed-out `run` left behind.
 */
export async function stop(target: ComposeTarget): Promise<void> {
  await compose(target, ["stop"], { timeoutMs: 60_000, logAs: `${projectName(target.pr)} stop` });
  const oneoffs = await run(
    [
      "docker",
      "ps",
      "--all",
      "--quiet",
      "--filter",
      `label=${COMPOSE_PROJECT}=${projectName(target.pr)}`,
      "--filter",
      "label=com.docker.compose.oneoff=True",
    ],
    { timeoutMs: LIST_TIMEOUT_MS },
  );
  const ids = lines(oneoffs.stdout);
  if (ids.length > 0) await run(["docker", "rm", "--force", ...ids], { timeoutMs: 60_000 });
}

/** A failed command's last line of output, for a log or an error. */
export function failure(result: RunResult): string {
  if (result.timedOut) return "timed out";
  const last = lines(`${result.stdout}\n${result.stderr}`).at(-1);
  return last === undefined ? `exited ${result.exitCode}` : `exited ${result.exitCode}: ${last}`;
}
