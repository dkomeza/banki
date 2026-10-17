import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export type SetupToken = {
  /** The token itself, for the startup log. */
  readonly value: string;
  /** Whether `candidate` is the token, compared in constant time; always false once discarded. */
  matches: (candidate: string) => boolean;
  /** Invalidates the token, once Setup is done. */
  discard: () => void;
};

// Hashing both sides first gives equal-length inputs for timingSafeEqual, so
// neither the comparison nor its length check reveals anything about the token.
const digest = (value: string) => createHash("sha256").update(value).digest();

/**
 * A fresh Setup token: 256 random bits, kept in memory only, so a restart
 * replaces it.
 */
export function createSetupToken(): SetupToken {
  const value = randomBytes(32).toString("base64url");
  const expected = digest(value);
  let discarded = false;

  return {
    value,
    matches: (candidate) => timingSafeEqual(digest(candidate), expected) && !discarded,
    discard: () => {
      discarded = true;
    },
  };
}
