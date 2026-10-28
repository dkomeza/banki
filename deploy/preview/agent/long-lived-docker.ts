import { join } from "node:path";
import { failure, lines, serviceState, setupInvocation, UP_WAIT_SECONDS } from "./docker";
import { AGENT_IMAGE } from "./helper";
import type {
  LongLivedInstallation,
  LongLivedProject,
  LongLivedVolume,
} from "./long-lived-planner";
import {
  LONG_LIVED_LABELS,
  type LongLivedEnvironment,
  longLivedHost,
  longLivedProject,
  longLivedVolume,
} from "./naming";
import type { ImageDigests } from "./planner";
import { run, type RunOptions, type RunResult } from "./run";

// The Docker adapter of the Long-lived installations (ADR-0017): finds Edge's
// and Production's projects and data volumes, runs the Long-lived template's
// `docker compose` commands, and the Snapshot script in a one-off container.

/** The Long-lived template, baked into the agent's image beside the Preview one. */
const TEMPLATE = join(import.meta.dir, "..", "long-lived.compose.yaml");

const COMPOSE_PROJECT = "com.docker.compose.project";

const LABEL_FIELDS = [
  COMPOSE_PROJECT,
  LONG_LIVED_LABELS.sha,
  LONG_LIVED_LABELS.deployedAt,
  LONG_LIVED_LABELS.apiDigest,
  LONG_LIVED_LABELS.webDigest,
];
const CONTAINER_FORMAT = [
  ...LABEL_FIELDS.map((label) => `{{.Label "${label}"}}`),
  `{{.Label "com.docker.compose.service"}}`,
  `{{.Label "com.docker.compose.oneoff"}}`,
  "{{.State}}",
].join("\t");
const VOLUME_FORMAT = `{{.Name}}\t{{.Label "${LONG_LIVED_LABELS.deployment}"}}`;

const LIST_TIMEOUT_MS = 30_000;

/** Edge's and Production's projects and data volumes, as Docker has them. */
export async function discoverLongLived(): Promise<
  Record<LongLivedEnvironment, LongLivedInstallation>
> {
  const [containers, volumes] = await Promise.all([
    list([
      "docker",
      "ps",
      "--all",
      "--filter",
      `label=${COMPOSE_PROJECT}`,
      "--format",
      CONTAINER_FORMAT,
    ]),
    list(["docker", "volume", "ls", "--format", VOLUME_FORMAT]),
  ]);
  return longLivedFrom({ containers, volumes });
}

async function list(argv: string[]): Promise<string> {
  const result = await run(argv, { timeoutMs: LIST_TIMEOUT_MS });
  if (result.exitCode !== 0) {
    throw new Error(`${argv.slice(0, 3).join(" ")} failed: ${failure(result)}`);
  }
  return result.stdout;
}

/**
 * Each installation from the listed containers of exactly `banki-edge` or
 * `banki-production`, and the volume of exactly its name. Pure, so it is
 * unit-tested.
 */
export function longLivedFrom(listed: {
  containers: string;
  volumes: string;
}): Record<LongLivedEnvironment, LongLivedInstallation> {
  const containers = lines(listed.containers).map((line) => line.split("\t"));
  const volumes = lines(listed.volumes).map((line) => line.split("\t"));
  const installation = (environment: LongLivedEnvironment): LongLivedInstallation => {
    const services = containers.filter(
      ([project, , , , , , oneoff]) =>
        project === longLivedProject(environment) && oneoff !== "True",
    );
    const volume = volumes.find(([name]) => name === longLivedVolume(environment));
    return { project: projectOf(services), volume: volumeOf(volume) };
  };
  return { edge: installation("edge"), production: installation("production") };
}

function projectOf(services: string[][]): LongLivedProject | undefined {
  if (services.length === 0) return undefined;
  const label = (index: number) =>
    services.map((fields) => fields[index]).find((value) => value !== undefined && value !== "");
  const state = (name: string) => {
    const found = services.find((fields) => fields[5] === name);
    return found === undefined ? "missing" : serviceState(found[7] ?? "");
  };
  const [sha, deployedAt, api, web] = [label(1), label(2), label(3), label(4)];
  return {
    sha,
    deployedAt:
      deployedAt === undefined || Number.isNaN(Date.parse(deployedAt))
        ? undefined
        : new Date(deployedAt),
    digests: api !== undefined && web !== undefined ? { api, web } : undefined,
    api: state("api"),
    web: state("web"),
  };
}

function volumeOf(fields: string[] | undefined): LongLivedVolume {
  if (fields === undefined) return { exists: false };
  const label = fields[1] ?? "";
  return {
    exists: true,
    deploymentId: /^[1-9][0-9]*$/.test(label) ? Number(label) : undefined,
  };
}

/** What the Long-lived template needs to render: the installation, its commit, the images and when. */
export type LongLivedTarget = {
  environment: LongLivedEnvironment;
  sha: string;
  deployedAt: Date;
  digests: ImageDigests;
};

/** The template's variables for a target. Pure, so the template's tests render with it. */
export function longLivedEnv(target: LongLivedTarget): Record<string, string> {
  return {
    LONG_LIVED_ENV: target.environment,
    LONG_LIVED_HOST: longLivedHost(target.environment),
    LONG_LIVED_VOLUME: longLivedVolume(target.environment),
    LONG_LIVED_SHA: target.sha,
    LONG_LIVED_DEPLOYED_AT: target.deployedAt.toISOString(),
    LONG_LIVED_RELEASE: String(target.environment === "production"),
    API_DIGEST: target.digests.api,
    WEB_DIGEST: target.digests.web,
  };
}

const logName = (target: { environment: LongLivedEnvironment }, step: string) =>
  `${longLivedProject(target.environment)} ${step}`;

function compose(target: LongLivedTarget, args: string[], options: RunOptions): Promise<RunResult> {
  return run(
    [
      "docker",
      "compose",
      "--project-name",
      longLivedProject(target.environment),
      "--file",
      TEMPLATE,
      ...args,
    ],
    { ...options, env: { ...longLivedEnv(target), ...options.env } },
  );
}

/**
 * Removes the project's containers (one-offs included) and network. Never
 * `--volumes`: the data volume is external anyway, and only a first boot's
 * own is ever removed, by {@link removeVolume}.
 */
export const down = (target: LongLivedTarget) =>
  compose(target, ["down", "--remove-orphans"], {
    timeoutMs: 180_000,
    logAs: logName(target, "down"),
  });

export const pull = (target: LongLivedTarget) =>
  compose(target, ["pull", "--quiet"], { timeoutMs: 600_000, logAs: logName(target, "pull") });

/** `banki setup` on a first boot of Edge: the Password on stdin only. */
export function setup(target: LongLivedTarget, email: string, password: string) {
  const { args, stdin } = setupInvocation(email, password);
  return compose(target, args, { timeoutMs: 120_000, stdin, logAs: logName(target, "setup") });
}

export const seed = (target: LongLivedTarget) =>
  compose(target, ["run", "--rm", "-T", "api", "bun", "run", "banki", "seed"], {
    timeoutMs: 120_000,
    logAs: logName(target, "seed"),
  });

/** Starts the target's images; the api migrates the data on its start. */
export const up = (target: LongLivedTarget) =>
  compose(target, ["up", "--detach", "--wait", "--wait-timeout", String(UP_WAIT_SECONDS)], {
    timeoutMs: (UP_WAIT_SECONDS + 60) * 1000,
    logAs: logName(target, "up"),
  });

/** Each service's state and health (empty for `web`, which has no healthcheck). */
export async function serviceStates(
  target: LongLivedTarget,
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

/** `/api/health` from inside `web`, through Caddy to the API, as for a Preview. */
export const health = (target: LongLivedTarget) =>
  compose(target, ["exec", "-T", "web", "wget", "-qO-", "http://localhost:8080/api/health"], {
    timeoutMs: 30_000,
  });

/**
 * Stops the installation's services, whichever images they run, and removes
 * any one-off container a timed-out `run` left behind. Fails when they
 * didn't stop, so nothing touches the data while the api may still write.
 */
export async function stop(target: LongLivedTarget): Promise<RunResult> {
  const stopped = await compose(target, ["stop"], {
    timeoutMs: 60_000,
    logAs: logName(target, "stop"),
  });
  if (stopped.exitCode !== 0) return stopped;
  const oneoffs = await run(
    [
      "docker",
      "ps",
      "--all",
      "--quiet",
      "--filter",
      `label=${COMPOSE_PROJECT}=${longLivedProject(target.environment)}`,
      "--filter",
      "label=com.docker.compose.oneoff=True",
    ],
    { timeoutMs: LIST_TIMEOUT_MS },
  );
  if (oneoffs.exitCode !== 0) return oneoffs;
  const ids = lines(oneoffs.stdout);
  if (ids.length === 0) return oneoffs;
  return run(["docker", "rm", "--force", ...ids], { timeoutMs: 60_000 });
}

/** The data volume of a first boot, labelled with the Deployment that made it. */
export const createVolume = (environment: LongLivedEnvironment, deploymentId: number) =>
  run(
    [
      "docker",
      "volume",
      "create",
      "--label",
      `${LONG_LIVED_LABELS.environment}=${environment}`,
      "--label",
      `${LONG_LIVED_LABELS.deployment}=${deploymentId}`,
      longLivedVolume(environment),
    ],
    { timeoutMs: LIST_TIMEOUT_MS, logAs: logName({ environment }, "volume create") },
  );

/** Removes the data volume: only ever a failed or interrupted first boot's own. */
export const removeVolume = (environment: LongLivedEnvironment) =>
  run(["docker", "volume", "rm", longLivedVolume(environment)], {
    timeoutMs: LIST_TIMEOUT_MS,
    logAs: logName({ environment }, "volume rm"),
  });

/** The Snapshot script's commands (snapshot.ts). */
export type SnapshotCommand = ["take" | "restore", number] | ["prune"];

/**
 * The `docker run` of the Snapshot script: the agent's own image, with only
 * the installation's volume at /data, no network, a read-only root, every
 * capability dropped, as the volume's owner (the app images' `bun`, uid
 * 1000). Pure, so it is unit-tested.
 */
export function snapshotInvocation(
  environment: LongLivedEnvironment,
  command: SnapshotCommand,
): string[] {
  return [
    "docker",
    "run",
    "--rm",
    "--pull",
    "never",
    "--network",
    "none",
    "--read-only",
    "--tmpfs",
    "/tmp",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges:true",
    "--user",
    "1000:1000",
    "--volume",
    `${longLivedVolume(environment)}:/data`,
    AGENT_IMAGE,
    "bun",
    "agent/snapshot.ts",
    ...command.map(String),
  ];
}

export const snapshot = (environment: LongLivedEnvironment, command: SnapshotCommand) =>
  run(snapshotInvocation(environment, command), {
    timeoutMs: 300_000,
    logAs: logName({ environment }, `snapshot ${command[0]}`),
  });

/** Removes a local image by digest. One a container still uses, or already gone, fails harmlessly. */
export const removeImage = (ref: string) =>
  run(["docker", "image", "rm", ref], { timeoutMs: 60_000 });
