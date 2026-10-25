import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "../config";
import { createAtomically } from "../create-atomically";

/** Thrown by {@link loadEncryptionKey} when the key file can't be used; startup fails with it. */
export class EncryptionKeyError extends Error {
  override name = "EncryptionKeyError";
}

/** The length of the encryption key, in bytes: AES-256's. */
export const ENCRYPTION_KEY_BYTES = 32;

/** What an encryption key must be, for the messages that refuse one. */
export const ENCRYPTION_KEY_FORMAT = `${ENCRYPTION_KEY_BYTES} bytes as base64url (43 characters)`;

/**
 * The key `text` holds, when it is exactly 32 bytes as unpadded base64url;
 * undefined otherwise. Node's decoder skips characters it doesn't know, so
 * the text must also be what the bytes encode back to.
 */
export function decodeEncryptionKey(text: string): Buffer | undefined {
  const key = Buffer.from(text, "base64url");
  if (key.length !== ENCRYPTION_KEY_BYTES || key.toString("base64url") !== text) return undefined;
  return key;
}

/**
 * The key the API key is encrypted with (ADR-0014): `ENCRYPTION_KEY` when
 * set, otherwise `<dataDir>/encryption-key`, generated on the first start (32
 * random bytes as base64url, readable by its owner only) and read back on
 * later ones. It is kept apart from the auth secret, so signing out every
 * device leaves the API key readable. The data directory must already exist.
 */
export function loadEncryptionKey({
  dataDir,
  encryptionKey,
}: Pick<Config, "dataDir" | "encryptionKey">): Buffer {
  if (encryptionKey !== undefined) {
    const key = decodeEncryptionKey(encryptionKey);
    if (key === undefined) {
      throw new EncryptionKeyError(`ENCRYPTION_KEY isn't ${ENCRYPTION_KEY_FORMAT}.`);
    }
    return key;
  }

  const file = join(dataDir, "encryption-key");
  const generated = randomBytes(ENCRYPTION_KEY_BYTES);
  let created: boolean;
  try {
    created = createAtomically(file, generated.toString("base64url"));
  } catch (error) {
    throw new EncryptionKeyError(`Can't create the encryption key at ${file}`, { cause: error });
  }
  if (created) return generated;

  let text: string;
  try {
    text = readFileSync(file, "utf8").trim();
  } catch (error) {
    throw new EncryptionKeyError(`Can't read the encryption key from ${file}`, { cause: error });
  }
  const key = decodeEncryptionKey(text);
  if (key === undefined) {
    throw new EncryptionKeyError(
      `The encryption key in ${file} isn't ${ENCRYPTION_KEY_FORMAT}. Restore it from a backup, ` +
        "or delete it to generate a new one, after which the stored API key has to be entered again.",
    );
  }
  return key;
}
