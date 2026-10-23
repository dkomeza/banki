import { join } from "node:path";
import type { ServiceResources } from "./config";
import {
  keyOf,
  LABELS,
  poolOf,
  prFromProjectName,
  type PreviewKey,
  previewHost,
  projectName,
  slugFromProjectName,
} from "./naming";
import type { DockerProject, ImageDigests, ServiceState } from "./planner";
import { run, type RunOptions, type RunResult } from "./run";
import type { SlugProject } from "./slug-planner";

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

/**
 * Every `banki-pr-<N>` and every `banki-slug-<slug>` project, found from any
 * of its containers, volumes or networks, in two pools.
 */
export async function discoverProjects(): Promise<{ prs: DockerProject[]; slugs: SlugProject[] }> {
  const filter = ["--filter", `label=${COMPOSE_PROJECT}`];
  const [containers, volumes, networks] = await Promise.all([
    list(["docker", "ps", "--all", ...filter, "--format", CONTAINER_FORMAT]),
    list(["docker", "volume", "ls", ...filter, "--format", LABELS_FORMAT]),
    list(["docker", "network", "ls", ...filter, "--format", LABELS_FORMAT]),
  ]);
  const listed = { containers, volumes, networks };
  return { prs: projectsFrom(listed), slugs: slugProjectsFrom(listed) };
}

async function list(argv: string[]): Promise<string> {
  const result = await run(argv, { timeoutMs: LIST_TIMEOUT_MS });
  if (result.exitCode !== 0) {
    throw new Error(`${argv.slice(0, 3).join(" ")} failed: ${failure(result)}`);
  }
  return result.stdout;
}

type DockerObject<K> = {
  key: K;
  labels: string[];
  /** For a service container: its service and state. */
  service?: { name: string; state: ServiceState };
};

type Listed = { containers: string; volumes: string; networks: string };

/** Groups the listed objects of `banki-pr-<N>` projects into PR Previews. Pure, so it is unit-tested. */
export function projectsFrom(listed: Listed): DockerProject[] {
  return projectsBy(listed, prFromProjectName, (a, b) => a - b).map(({ key, ...project }) => ({
    pr: key,
    ...project,
  }));
}

/** Groups the listed objects of `banki-slug-<slug>` projects into Slug Previews. Pure, so it is unit-tested. */
export function slugProjectsFrom(listed: Listed): SlugProject[] {
  return projectsBy(listed, slugFromProjectName, (a, b) => (a < b ? -1 : a > b ? 1 : 0)).map(
    ({ key, ...project }) => ({ slug: key, ...project }),
  );
}

function projectsBy<K extends PreviewKey>(
  listed: Listed,
  keyFromName: (name: string) => K | undefined,
  order: (a: K, b: K) => number,
): (Omit<DockerProject, "pr"> & { key: K })[] {
  const parseObject = (line: string): DockerObject<K> | undefined => {
    const [project = "", ...labels] = line.split("\t");
    const key = keyFromName(project);
    return key === undefined
      ? undefined
      : { key, labels: labels.slice(0, LABEL_FIELDS.length - 1) };
  };
  const containers = lines(listed.containers).flatMap((line): DockerObject<K>[] => {
    const object = parseObject(line);
    if (object === undefined) return [];
    const [name = "", oneoff = "", state = ""] = line.split("\t").slice(LABEL_FIELDS.length);
    if (oneoff === "True") return [object];
    return [{ ...object, service: { name, state: serviceState(state) } }];
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

  const keys = [...new Set(objects.map((object) => object.key))].toSorted(order);
  return keys.map((key) => {
    const found = objects.filter((object) => object.key === key);
    const label = (index: number) =>
      found
        .map((object) => object.labels[index])
        .find((value) => value !== undefined && value !== "");
    const state = (service: string): ServiceState =>
      found.find((object) => object.service?.name === service)?.service?.state ?? "missing";
    const [sha, deployedAt, api, web] = [label(0), label(1), label(2), label(3)];
    return {
      key,
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

/** Docker's `{{.State}}` as the planner sees it: any state but these three is stopped. */
const serviceState = (state: string): ServiceState =>
  state === "running" || state === "restarting" || state === "paused" ? state : "stopped";

const lines = (text: string) => text.split("\n").filter((line) => line.trim() !== "");

/**
 * What the template needs to render: the Preview's key, its commit, the
 * images, when, and its pool's limits.
 */
export type ComposeTarget = {
  key: PreviewKey;
  sha: string;
  deployedAt: Date;
  digests: ImageDigests;
  resources: ServiceResources;
};

// Stands in for what a project's labels don't say, so the template still
// renders for a `down`. No image has this digest, so `--rmi all` skips it.
const NO_DIGEST = `sha256:${"0".repeat(64)}`;
export const NO_DIGESTS: ImageDigests = { api: NO_DIGEST, web: NO_DIGEST };

/** The target to take `project` down with: the images it was deployed from, when known. */
export function targetOf(
  project: DockerProject | SlugProject,
  now: Date,
  resources: ServiceResources,
): ComposeTarget {
  return {
    key: keyOf(project),
    sha: project.sha ?? "unknown",
    deployedAt: project.deployedAt ?? now,
    digests: project.digests ?? NO_DIGESTS,
    resources,
  };
}

/** The template's variables for a target. Pure, so the template's tests render with it. */
export function composeEnv(target: ComposeTarget): Record<string, string> {
  return {
    PREVIEW_POOL: poolOf(target.key),
    PREVIEW_KEY: String(target.key),
    PREVIEW_HOST: previewHost(target.key),
    PREVIEW_SHA: target.sha,
    PREVIEW_DEPLOYED_AT: target.deployedAt.toISOString(),
    API_DIGEST: target.digests.api,
    WEB_DIGEST: target.digests.web,
    API_MEMORY: target.resources.apiMemory,
    API_CPUS: target.resources.apiCpus,
    WEB_MEMORY: target.resources.webMemory,
    WEB_CPUS: target.resources.webCpus,
  };
}

function compose(target: ComposeTarget, args: string[], options: RunOptions): Promise<RunResult> {
  return run(
    ["docker", "compose", "--project-name", projectName(target.key), "--file", TEMPLATE, ...args],
    { ...options, env: { ...composeEnv(target), ...options.env } },
  );
}

/** Removes the project's containers (one-offs included), volumes, networks and images. */
export const down = (target: ComposeTarget) =>
  compose(target, ["down", "--volumes", "--remove-orphans", "--rmi", "all"], {
    timeoutMs: 180_000,
    logAs: `${projectName(target.key)} down`,
  });

export const pull = (target: ComposeTarget) =>
  compose(target, ["pull", "--quiet"], {
    timeoutMs: 600_000,
    logAs: `${projectName(target.key)} pull`,
  });

/**
 * The `docker compose` arguments and stdin of `banki setup`. The Password goes
 * in on stdin only, never in argv or an environment; the command never
 * prints it. Pure, so it is unit-tested.
 */
export function setupInvocation(email: string, password: string) {
  return {
    args: [
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
    stdin: `${password}\n`,
  };
}

/** `banki setup` against the fresh volume. */
export function setup(target: ComposeTarget, email: string, password: string) {
  const { args, stdin } = setupInvocation(email, password);
  return compose(target, args, {
    timeoutMs: 120_000,
    stdin,
    logAs: `${projectName(target.key)} setup`,
  });
}

export const seed = (target: ComposeTarget) =>
  compose(target, ["run", "--rm", "-T", "api", "bun", "run", "banki", "seed"], {
    timeoutMs: 120_000,
    logAs: `${projectName(target.key)} seed`,
  });

export const UP_WAIT_SECONDS = 60;

export const up = (target: ComposeTarget) =>
  compose(target, ["up", "--detach", "--wait", "--wait-timeout", String(UP_WAIT_SECONDS)], {
    timeoutMs: (UP_WAIT_SECONDS + 60) * 1000,
    logAs: `${projectName(target.key)} up`,
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
  await compose(target, ["stop"], { timeoutMs: 60_000, logAs: `${projectName(target.key)} stop` });
  const oneoffs = await run(
    [
      "docker",
      "ps",
      "--all",
      "--quiet",
      "--filter",
      `label=${COMPOSE_PROJECT}=${projectName(target.key)}`,
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
