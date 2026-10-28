import { getLogger } from "@logtape/logtape";
import type { ImageSweep } from "./repositories/images";

const logger = getLogger(["banki", "removal"]);

/** How often the sweep runs after its first run at start. */
export const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Runs `removeExpired` (the Removal of every Deletion 30 days old) and then
 * `sweepImages` (the Images no Card refers to and the files with no Image
 * row, once 24 hours old) now and then every `intervalMs`, logging what they
 * deleted. Either one that throws is logged, the other still runs, and the
 * next sweep runs as usual. Answers a function that stops it.
 */
export function startRemovalSweep(
  { removeExpired, sweepImages }: { removeExpired: () => number; sweepImages: () => ImageSweep },
  intervalMs = SWEEP_INTERVAL_MS,
): () => void {
  const sweep = () => {
    try {
      const removed = removeExpired();
      if (removed > 0) logger.info("Removed {removed} expired deletions", { removed });
    } catch (error) {
      logger.error("Removing expired deletions failed", { error });
    }
    try {
      const { images, files } = sweepImages();
      if (images > 0 || files > 0) {
        logger.info("Deleted {images} unreferenced images and {files} files with no image", {
          images,
          files,
        });
      }
    } catch (error) {
      logger.error("Deleting unreferenced images failed", { error });
    }
  };
  sweep();
  const timer = setInterval(sweep, intervalMs);
  return () => clearInterval(timer);
}
