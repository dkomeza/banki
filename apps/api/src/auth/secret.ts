import { randomBytes } from "node:crypto";
import { closeSync, fsyncSync, linkSync, openSync, readFileSync, rmSync, writeSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "../config";

/** Thrown by {@link loadAuthSecret} when the secret file can't be used; startup fails with it. */
export class AuthSecretError extends Error {
  override name = "AuthSecretError";
}

/** The shortest secret accepted, from the file as from `AUTH_SECRET`. */
const MIN_LENGTH = 32;

const isErrorCode = (error: unknown, code: string) =>
  error instanceof Error && "code" in error && error.code === code;

/**
 * Writes `secret` to `file` all at once: it goes to a temp file beside it
 * first and is then hard-linked into place, so `file` never exists half
 * written, even if the process dies. Returns false when `file` already
 * exists, leaving it alone.
 */
function createAtomically(file: string, secret: string): boolean {
  const temp = `${file}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    const fd = openSync(temp, "wx", 0o600);
    try {
      writeSync(fd, secret);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    linkSync(temp, file);
    return true;
  } catch (error) {
    if (isErrorCode(error, "EEXIST")) return false;
    throw new AuthSecretError(`Can't create the auth secret at ${file}`, { cause: error });
  } finally {
    rmSync(temp, { force: true });
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
  if (createAtomically(file, generated)) return generated;

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
