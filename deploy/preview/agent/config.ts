import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Limits } from "./planner";

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
