import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
/** Marks the format a stored API key is in, so a later one can be told apart. */
const VERSION = "v1";

export type ApiKeyCipher = ReturnType<typeof createApiKeyCipher>;

/**
 * Encrypts and decrypts the User's API key with AES-256-GCM under `key`, a
 * fresh random nonce on every encryption. The User's ID is bound in as
 * associated data, so a stored key only decrypts for the User it was stored
 * for. A stored key is `v1.<base64url of nonce, ciphertext and tag>`.
 */
export function createApiKeyCipher(key: Buffer) {
  return {
    encrypt(apiKey: string, userId: string): string {
      const nonce = randomBytes(NONCE_BYTES);
      const cipher = createCipheriv(ALGORITHM, key, nonce, { authTagLength: TAG_BYTES });
      cipher.setAAD(Buffer.from(userId, "utf8"));
      const ciphertext = Buffer.concat([cipher.update(apiKey, "utf8"), cipher.final()]);
      const sealed = Buffer.concat([nonce, ciphertext, cipher.getAuthTag()]);
      return `${VERSION}.${sealed.toString("base64url")}`;
    },

    /**
     * The API key `stored` holds, or undefined when it can't be read: stored
     * under another encryption key (lost or changed), for another User, or
     * not in a format this release knows.
     */
    decrypt(stored: string, userId: string): string | undefined {
      const [version, body, ...rest] = stored.split(".");
      if (version !== VERSION || body === undefined || rest.length > 0) return undefined;
      const sealed = Buffer.from(body, "base64url");
      if (sealed.length < NONCE_BYTES + TAG_BYTES) return undefined;
      const nonce = sealed.subarray(0, NONCE_BYTES);
      const tag = sealed.subarray(sealed.length - TAG_BYTES);
      const ciphertext = sealed.subarray(NONCE_BYTES, sealed.length - TAG_BYTES);
      try {
        const decipher = createDecipheriv(ALGORITHM, key, nonce, { authTagLength: TAG_BYTES });
        decipher.setAAD(Buffer.from(userId, "utf8"));
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
      } catch {
        return undefined;
      }
    },
  };
}
