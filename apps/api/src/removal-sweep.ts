import { getLogger } from "@logtape/logtape";

const logger = getLogger(["banki", "removal"]);

/** How often the sweep runs after its first run at start. */
export const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Runs `removeExpired` (the Removal of every Deletion 30 days old) now and
 * then every `intervalMs`, logging what it removed. A run that throws is
 * logged and the next one runs as usual. Answers a function that stops it.
 */
export function startRemovalSweep(
  removeExpired: () => number,
  intervalMs = SWEEP_INTERVAL_MS,
): () => void {
  const sweep = () => {
    try {
      const removed = removeExpired();
      if (removed > 0) logger.info("Removed {removed} expired deletions", { removed });
    } catch (error) {
      logger.error("Removing expired deletions failed", { error });
    }
  };
  sweep();
  const timer = setInterval(sweep, intervalMs);
  return () => clearInterval(timer);
}
