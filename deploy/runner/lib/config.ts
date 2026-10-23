import { readFileSync } from "node:fs";
import { join } from "node:path";

// What the Runner reads from outside: compose secrets under /run/secrets (so
// none is in an environment in `docker inspect`), and the settings that
// aren't secret, from the environment. All of it is written by
// `deploy/runner/bootstrap`, outside the clone. Each container gets only its
// own secrets: the broker the App key and the Linear client secret, the
// runner the Claude token.

const SECRETS_DIR = process.env.SECRETS_DIR ?? "/run/secrets";

export class ConfigError extends Error {
  override name = "ConfigError";
}

export const SECRETS = {
  githubAppKey: "github-app-key",
  linearClientSecret: "linear-client-secret",
  claudeToken: "claude-token",
} as const;

/** One secret file's content, without surrounding whitespace. */
export function readSecret(name: string): string {
  let value: string;
  try {
    value = readFileSync(join(SECRETS_DIR, name), "utf8").trim();
  } catch (error) {
    throw new ConfigError(
      `Can't read the secret ${name} in ${SECRETS_DIR}: ${error instanceof Error ? error.message : String(error)}. Run deploy/runner/bootstrap.`,
    );
  }
  if (value === "") {
    throw new ConfigError(`The secret ${name} is empty. Run deploy/runner/bootstrap.`);
  }
  return value;
}

export function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (value === undefined || value === "") {
    throw new ConfigError(`${name} is not set. Run deploy/runner/bootstrap.`);
  }
  return value;
}

/** The broker's socket, on the volume both containers mount. */
export const brokerSocket = () =>
  process.env.BANKI_BROKER_SOCKET ?? "/run/banki-broker/broker.sock";

export const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
