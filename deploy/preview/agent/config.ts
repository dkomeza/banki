import { readFileSync } from "node:fs";
import { join } from "node:path";

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
