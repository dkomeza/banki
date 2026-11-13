// Handwriting on the study screen, before Check (docs/design.md § Handwriting):
// the canvas takes the whole screen, and the Front sits on its paper like an
// image on a board. These are the rules for where it sits and how large it is
// drawn; the layout itself is components/study/handwriting.tsx.

/** The study route's search params: `?handwriting=1` shows the handwriting layout. */
export type StudySearch = { handwriting?: 1 };

/** Reads the study route's search params, keeping only `?handwriting=1`. */
export function handwritingSearch(search: Record<string, unknown>): StudySearch {
  const value = search["handwriting"];
  return value === 1 || value === "1" ? { handwriting: 1 } : {};
}

/** The smallest and largest the Front is drawn, 1 being the size its type is at. */
export const FRONT_SCALE = { min: 0.4, max: 2.5 } as const;

/** A long Front starts scaled down to at most this share of the canvas's height. */
const FIT_SHARE = 0.6;

/** Where a Card's Front starts on the canvas, its label above it. */
export const FRONT_AT = { x: 12, y: 28 } as const;

/** How much of the Front stays on the canvas, across and down, so it can be grabbed again. */
const KEEP = 48;

/** How wide the Front's text is at 100%: a column on a wide canvas, else the canvas less the tool bar. */
export function frontWidth(canvasWidth: number): number {
  return canvasWidth >= 1000 ? 416 : Math.max(240, canvasWidth - 80);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

/**
 * The scale a Card's Front starts at: the one the User last chose (100% before
 * that), but no taller than 60% of the canvas, so a long Front shows whole.
 * `natural` is how tall all of it is at 100%; 0 before it is measured.
 */
export function startScale({
  natural,
  canvasHeight,
  kept,
}: {
  natural: number;
  canvasHeight: number;
  kept: number | null;
}): number {
  const fit = natural > 0 && canvasHeight > 0 ? (canvasHeight * FIT_SHARE) / natural : 1;
  return clamp(Math.min(kept ?? 1, fit), FRONT_SCALE.min, FRONT_SCALE.max);
}

export type Corner = "tl" | "tr" | "bl" | "br";

/**
 * Where the Front is and how large, after its `corner` is dragged by `dx`,
 * `dy` from where it was: it scales about the opposite corner, keeping its
 * shape, by whichever way the corner moved further. `width` and `height` are
 * its size on screen as the drag started.
 */
export function scaleFromCorner(
  from: { x: number; y: number; scale: number; width: number; height: number },
  corner: Corner,
  dx: number,
  dy: number,
): { x: number; y: number; scale: number } {
  const sx = corner.endsWith("r") ? 1 : -1;
  const sy = corner.startsWith("b") ? 1 : -1;
  const rx = (from.width + sx * dx) / from.width;
  const ry = from.height > 0 ? (from.height + sy * dy) / from.height : rx;
  const r = Math.abs(rx - 1) >= Math.abs(ry - 1) ? rx : ry;
  const scale = clamp(from.scale * r, FRONT_SCALE.min, FRONT_SCALE.max);
  const by = scale / from.scale;
  return {
    scale,
    x: sx < 0 ? from.x + from.width * (1 - by) : from.x,
    y: sy < 0 ? from.y + from.height * (1 - by) : from.y,
  };
}

/**
 * Where the Front of `size` shows at `at`: past the canvas's edges only so
 * far that 48 px of it stays on the canvas to grab it again. The canvas
 * doesn't pan yet, so a Front taller than it is moved up to read the rest.
 */
export function keepOnCanvas(
  at: { x: number; y: number },
  size: { w: number; h: number },
  canvas: { w: number; h: number },
): { x: number; y: number } {
  return {
    x: clamp(at.x, Math.min(0, KEEP - size.w), canvas.w - KEEP),
    y: clamp(at.y, Math.min(0, KEEP - size.h), canvas.h - KEEP),
  };
}
