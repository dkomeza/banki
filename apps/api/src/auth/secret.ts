import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "../config";

/** Thrown by {@link loadAuthSecret} when the secret file can't be used; startup fails with it. */
export class AuthSecretError extends Error {
  override name = "AuthSecretError";
}

const isErrorCode = (error: unknown, code: string) =>
  error instanceof Error && "code" in error && error.code === code;

/**
 * The secret better-auth signs cookies with: `AUTH_SECRET` when set, otherwise
 * `<dataDir>/auth-secret`, generated on the first start (32 random bytes as
 * base64url, readable by its owner only) and read back on later ones. Changing
 * it signs out every device. The data directory must already exist.
 */
export function loadAuthSecret({ dataDir, authSecret }: Pick<Config, "dataDir" | "authSecret">) {
  if (authSecret !== undefined) return authSecret;

  const file = join(dataDir, "auth-secret");
  const generated = randomBytes(32).toString("base64url");
  try {
    // `wx` fails if the file exists, so an existing secret is never overwritten.
    writeFileSync(file, generated, { mode: 0o600, flag: "wx" });
    return generated;
  } catch (error) {
    if (!isErrorCode(error, "EEXIST")) {
      throw new AuthSecretError(`Can't create the auth secret at ${file}`, { cause: error });
    }
  }

  let secret: string;
  try {
    secret = readFileSync(file, "utf8").trim();
  } catch (error) {
    throw new AuthSecretError(`Can't read the auth secret from ${file}`, { cause: error });
  }
  if (secret === "") {
    throw new AuthSecretError(
      `The auth secret file ${file} is empty. Delete it to generate a new one, which signs out every device.`,
    );
  }
  return secret;
}
