export type RateLimitDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number };

export type RateLimiter = {
  /** Records one attempt for `key` and says whether it is allowed. */
  consume: (key: string) => RateLimitDecision;
};

/**
 * An in-memory, per-key limit of `max` attempts per window. A key's window
 * starts at its first attempt; refused attempts aren't counted, so they don't
 * push the end of the window back.
 */
export function createRateLimiter({
  max,
  windowMs,
  now = Date.now,
}: {
  max: number;
  windowMs: number;
  now?: () => number;
}): RateLimiter {
  const windows = new Map<string, { startedAt: number; count: number }>();

  return {
    consume(key) {
      const time = now();
      for (const [other, window] of windows) {
        if (time - window.startedAt >= windowMs) windows.delete(other);
      }

      const window = windows.get(key);
      if (window === undefined) {
        windows.set(key, { startedAt: time, count: 1 });
        return { allowed: true };
      }
      if (window.count < max) {
        window.count += 1;
        return { allowed: true };
      }
      return {
        allowed: false,
        retryAfterSeconds: Math.ceil((window.startedAt + windowMs - time) / 1000),
      };
    },
  };
}
