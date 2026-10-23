import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Limits } from "./planner";
import type { SlugLimits } from "./slug-planner";

// What the agent reads from outside: compose secrets under /run/secrets (the
// GitHub token, the Pangolin key, and the Preview's Email and Password, so
// none of them is in its environment in `docker inspect`), and the Pangolin
// IDs, which aren't secret, from its environment. All of it is written by
// `deploy/preview/bootstrap`, outside the clone.

const SECRETS_DIR = process.env.SECRETS_DIR ?? "/run/secrets";

export class ConfigError extends Error {
  override name = "ConfigError";
}

/**
 * One secret file's content, without surrounding whitespace. Read on every
 * use, so a value `bootstrap` rewrites in place applies without a restart.
 */
export function readSecret(name: string): string {
  let value: string;
  try {
    value = readFileSync(join(SECRETS_DIR, name), "utf8").trim();
  } catch (error) {
    throw new ConfigError(
      `Can't read the secret ${name} in ${SECRETS_DIR}: ${error instanceof Error ? error.message : String(error)}. Run deploy/preview/bootstrap.`,
    );
  }
  if (value === "") {
    throw new ConfigError(`The secret ${name} is empty. Run deploy/preview/bootstrap.`);
  }
  return value;
}

export const SECRETS = {
  githubToken: "github-token",
  pangolinApiKey: "pangolin-api-key",
  previewEmail: "preview-email",
  previewPassword: "preview-password",
} as const;

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (value === undefined || value === "") {
    throw new ConfigError(`${name} is not set. Run deploy/preview/bootstrap.`);
  }
  return value;
}

export function pangolinSettings() {
  return {
    apiUrl: requiredEnv("PANGOLIN_API_URL"),
    orgId: requiredEnv("PANGOLIN_ORG_ID"),
    siteNiceId: requiredEnv("PANGOLIN_SITE"),
  };
}

/**
 * How many Previews may run at once and after how many days without a push
 * one is removed: PREVIEW_CAP (a positive integer, default 5) and
 * PREVIEW_IDLE_DAYS (a positive number, decimals allowed, default 7), from
 * agent.env. Read on start, so a change needs `up -d --force-recreate`.
 */
export function previewLimits(env: Record<string, string | undefined> = process.env): Limits {
  return {
    cap: optionalEnv(env, "PREVIEW_CAP", 5, /^[0-9]+$/, "a positive whole number"),
    idleDays: optionalEnv(
      env,
      "PREVIEW_IDLE_DAYS",
      7,
      /^(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)$/,
      "a positive number of days, such as 7 or 0.5",
    ),
  };
}

/**
 * The memory and CPU limits of a Preview's two services, as the template's
 * `mem_limit` and `cpus` take them.
 */
export type ServiceResources = {
  apiMemory: string;
  apiCpus: string;
  webMemory: string;
  webCpus: string;
};

/** A PR Preview's limits, fixed. */
export const PR_PREVIEW_RESOURCES: ServiceResources = {
  apiMemory: "256m",
  apiCpus: "1.0",
  webMemory: "128m",
  webCpus: "0.5",
};

/**
 * The slug pool's limits (ADR-0011): SLUG_PREVIEW_CAP (a positive integer,
 * default 9) running at once, and each one's memory and CPUs, lower than a
 * PR Preview's. The api peaks at about 80 MiB on `banki setup` and on every
 * sign-in, hashing the Password, and is OOM-killed at 64m; `web` peaks at
 * about 21 MiB. From agent.env, read on start like {@link previewLimits}.
 */
export function slugPreviewLimits(
  env: Record<string, string | undefined> = process.env,
): SlugLimits & { resources: ServiceResources } {
  return {
    cap: optionalEnv(env, "SLUG_PREVIEW_CAP", 9, /^[0-9]+$/, "a positive whole number"),
    resources: {
      apiMemory: memoryEnv(env, "SLUG_PREVIEW_API_MEMORY", "128m"),
      apiCpus: cpusEnv(env, "SLUG_PREVIEW_API_CPUS", "0.5"),
      webMemory: memoryEnv(env, "SLUG_PREVIEW_WEB_MEMORY", "48m"),
      webCpus: cpusEnv(env, "SLUG_PREVIEW_WEB_CPUS", "0.25"),
    },
  };
}

/** Docker's smallest memory limit. */
const MIN_MEMORY_MB = 6;

/** A memory limit in whole megabytes or gigabytes, such as 128m or 1g, or `fallback`. */
function memoryEnv(env: Record<string, string | undefined>, name: string, fallback: string) {
  const value = env[name]?.trim();
  if (value === undefined || value === "") return fallback;
  const match = /^([1-9][0-9]*)([mg])$/.exec(value);
  const megabytes = match === null ? 0 : Number(match[1]) * (match[2] === "g" ? 1024 : 1);
  if (megabytes < MIN_MEMORY_MB) {
    throw new ConfigError(
      `${name} is ${JSON.stringify(value)}, not a memory limit of at least ${MIN_MEMORY_MB}m, such as 128m or 1g. Fix agent.env.`,
    );
  }
  return value;
}

/** A positive number of CPUs, such as 0.5 or 2, or `fallback`. */
function cpusEnv(env: Record<string, string | undefined>, name: string, fallback: string) {
  const value = env[name]?.trim();
  if (value === undefined || value === "") return fallback;
  optionalEnv(
    env,
    name,
    0,
    /^(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)$/,
    "a positive number of CPUs, such as 0.5 or 2",
  );
  return value;
}

/** A setting that is a positive number matching `pattern`, or `fallback` when it is unset or empty. */
function optionalEnv(
  env: Record<string, string | undefined>,
  name: string,
  fallback: number,
  pattern: RegExp,
  expected: string,
): number {
  const value = env[name]?.trim();
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!pattern.test(value) || !Number.isFinite(parsed) || parsed <= 0) {
    throw new ConfigError(`${name} is ${JSON.stringify(value)}, not ${expected}. Fix agent.env.`);
  }
  return parsed;
}
