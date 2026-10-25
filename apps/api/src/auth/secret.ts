import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "../config";
import { createAtomically } from "../create-atomically";

/** Thrown by {@link loadAuthSecret} when the secret file can't be used; startup fails with it. */
export class AuthSecretError extends Error {
  override name = "AuthSecretError";
}

/** The shortest secret accepted, from the file as from `AUTH_SECRET`. */
const MIN_LENGTH = 32;

/** Creates `file` holding `secret`, or returns false when it already exists. */
function createSecretFile(file: string, secret: string): boolean {
  try {
    return createAtomically(file, secret);
  } catch (error) {
    throw new AuthSecretError(`Can't create the auth secret at ${file}`, { cause: error });
  }
}

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
  if (createSecretFile(file, generated)) return generated;

  let secret: string;
  try {
    secret = readFileSync(file, "utf8").trim();
  } catch (error) {
    throw new AuthSecretError(`Can't read the auth secret from ${file}`, { cause: error });
  }
  const regenerate = "Delete it to generate a new one, which signs out every device.";
  if (secret === "") {
    throw new AuthSecretError(`The auth secret file ${file} is empty. ${regenerate}`);
  }
  if (secret.length < MIN_LENGTH) {
    throw new AuthSecretError(
      `The auth secret in ${file} is shorter than ${MIN_LENGTH} characters. ${regenerate}`,
    );
  }
  return secret;
}
