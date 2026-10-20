import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

// The pixel diff `ui compare` runs on each pair of shots: pixelmatch at a 0.1
// threshold, ignoring anti-aliased pixels (its defaults).

/**
 * The fraction of pixels that differ between two PNGs: 0 when they match, and
 * 1 when their sizes differ.
 */
export function differingFraction(before: Buffer, after: Buffer): number {
  const a = PNG.sync.read(before);
  const b = PNG.sync.read(after);
  if (a.width !== b.width || a.height !== b.height) return 1;
  const pixels = a.width * a.height;
  if (pixels === 0) return 0;
  return pixelmatch(a.data, b.data, undefined, a.width, a.height, { threshold: 0.1 }) / pixels;
}
