import { getStroke } from "perfect-freehand";

// Ink on the handwriting Canvas (ADR-0036; docs/design.md § Handwriting):
// Strokes as vector data in Canvas units, and the pure math of the view onto
// the Canvas (where it is panned to and how far it is zoomed). The pointers
// and the drawing are components/study/handwriting.tsx.

/** One sample of a Stroke: where the pen was, in Canvas units, and how hard it pressed (0 to 1). */
export type InkPoint = [x: number, y: number, pressure: number];

/** One line of Ink, from where the pen touched the Canvas to where it lifted. */
export type Stroke = { points: InkPoint[]; size: number };

/** The pen's thickness, in Canvas units: zooming in shows Ink thicker. */
export const INK_SIZE = { medium: 4 } as const;

/** How far the Canvas zooms, and how far − and + step it. */
export const ZOOM = { min: 0.25, max: 4, step: 1.25 } as const;

/** Fit leaves this much room, in screen px, around the Front and the Ink. */
export const FIT_MARGIN = 24;

/** The paper's grid, in Canvas units. */
export const GRID_SIZE = 24;

/**
 * The view onto the Canvas: a point at Canvas `c` shows on screen at
 * `c * zoom + (x, y)`, in px from the viewport's top-left. As CSS, that is
 * `translate(x, y) scale(zoom)` about the top-left.
 */
export type View = { x: number; y: number; zoom: number };

export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };

/** Each Card starts here: at 100%, with the Canvas's origin at the viewport's top-left. */
export const START_VIEW: View = { x: 0, y: 0, zoom: 1 };

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function clampZoom(zoom: number): number {
  return clamp(zoom, ZOOM.min, ZOOM.max);
}

/** The CSS transform of the layer that holds the Front and the Ink. */
export function viewTransform(view: View): string {
  return `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`;
}

/** Where a point on screen (px from the viewport's top-left) is on the Canvas. */
export function toCanvas(view: View, screen: Point): Point {
  return { x: (screen.x - view.x) / view.zoom, y: (screen.y - view.y) / view.zoom };
}

/** Where a point on the Canvas shows on screen. */
export function toScreen(view: View, canvas: Point): Point {
  return { x: canvas.x * view.zoom + view.x, y: canvas.y * view.zoom + view.y };
}

/** The view moved by `dx`, `dy` screen px: the paper follows the finger. */
export function panBy(view: View, dx: number, dy: number): View {
  return { ...view, x: view.x + dx, y: view.y + dy };
}

/** The view at `zoom` (kept within the range), with the paper under `about` (on screen) staying there. */
export function zoomAbout(view: View, zoom: number, about: Point): View {
  const z = clampZoom(zoom);
  const at = toCanvas(view, about);
  return { zoom: z, x: about.x - at.x * z, y: about.y - at.y * z };
}

/**
 * The view during a pinch that started at `start` with two fingers at
 * `from`, now at `to`: it zooms by how far the fingers spread, and the paper
 * that was between them stays between them.
 */
export function pinch(start: View, from: [Point, Point], to: [Point, Point]): View {
  const d0 = Math.hypot(from[1].x - from[0].x, from[1].y - from[0].y);
  const d1 = Math.hypot(to[1].x - to[0].x, to[1].y - to[0].y);
  const zoom = clampZoom(d0 > 0 ? (start.zoom * d1) / d0 : start.zoom);
  const m0 = { x: (from[0].x + from[1].x) / 2, y: (from[0].y + from[1].y) / 2 };
  const m1 = { x: (to[0].x + to[1].x) / 2, y: (to[0].y + to[1].y) / 2 };
  const at = toCanvas(start, m0);
  return { zoom, x: m1.x - at.x * zoom, y: m1.y - at.y * zoom };
}

/**
 * How much one wheel event with Ctrl/⌘ (or a trackpad's pinch) zooms: a
 * mouse wheel's notch (100 px) by about 1.25×, a trackpad's small steps by a little.
 */
export function wheelZoom(deltaY: number): number {
  return 2 ** (-deltaY / 310);
}

/** A wheel event's distance in px, whatever unit it came in (`deltaMode`: px, lines, pages). */
export function wheelPixels(delta: number, mode: number, page: number): number {
  return mode === 1 ? delta * 16 : mode === 2 ? delta * page : delta;
}

/**
 * How a wheel or a trackpad's scroll pans: the paper moves against the
 * scroll, and with Shift, a plain wheel's scroll pans across.
 */
export function wheelPan(deltaX: number, deltaY: number, shift: boolean): Point {
  if (shift && deltaX === 0) return { x: -deltaY, y: 0 };
  return { x: -deltaX, y: -deltaY };
}

/** The smallest rectangle around all of `rects`, or null for none. */
export function union(rects: readonly (Rect | null)[]): Rect | null {
  let out: Rect | null = null;
  for (const r of rects) {
    if (r === null) continue;
    if (out === null) {
      out = { ...r };
      continue;
    }
    const x = Math.min(out.x, r.x);
    const y = Math.min(out.y, r.y);
    out = {
      x,
      y,
      w: Math.max(out.x + out.w, r.x + r.w) - x,
      h: Math.max(out.y + out.h, r.y + r.h) - y,
    };
  }
  return out;
}

/** Where a Stroke reaches on the Canvas, its thickness included. */
export function strokeBounds(stroke: Stroke): Rect | null {
  if (stroke.points.length === 0) return null;
  let [minX, minY] = [Infinity, Infinity];
  let [maxX, maxY] = [-Infinity, -Infinity];
  for (const [x, y] of stroke.points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const r = stroke.size / 2;
  return { x: minX - r, y: minY - r, w: maxX - minX + 2 * r, h: maxY - minY + 2 * r };
}

/** Where all of the Ink reaches on the Canvas, or null with none. */
export function inkBounds(strokes: readonly Stroke[]): Rect | null {
  return union(strokes.map(strokeBounds));
}

/**
 * The view that shows all of `content` (Canvas units) in a viewport of
 * `size`, with `FIT_MARGIN` px around it, centred, as close as the zoom's
 * range lets it.
 */
export function fit(content: Rect, size: { w: number; h: number }): View {
  const room = { w: size.w - 2 * FIT_MARGIN, h: size.h - 2 * FIT_MARGIN };
  const zoom = clampZoom(
    Math.min(
      content.w > 0 ? room.w / content.w : ZOOM.max,
      content.h > 0 ? room.h / content.h : ZOOM.max,
    ),
  );
  return {
    zoom,
    x: size.w / 2 - (content.x + content.w / 2) * zoom,
    y: size.h / 2 - (content.y + content.h / 2) * zoom,
  };
}

/** The view one step of − (`-1`) or + (`1`) from `view`, about the viewport's centre. */
export function zoomStep(view: View, by: -1 | 1, size: { w: number; h: number }): View {
  return zoomAbout(view, view.zoom * ZOOM.step ** by, { x: size.w / 2, y: size.h / 2 });
}

/**
 * Whether a Stroke's pen reports no pressure of its own: every sample 0, or a
 * flat 0.5, as a pen without pressure and the Pointer Events default give.
 * Such a Stroke gets pressure simulated from its speed.
 */
export function pressureless(points: readonly InkPoint[]): boolean {
  return points.every(([, , p]) => p === 0 || p === 0.5);
}

/**
 * The outline of a Stroke, as perfect-freehand draws it: a polygon around
 * where the pen went, thinner where it pressed lightly. `done` when the
 * pen has lifted, which caps its end. `ahead` are the predicted samples past
 * the last real one, drawn but never kept.
 */
export function strokeOutline(
  stroke: Stroke,
  { done, ahead = [] }: { done: boolean; ahead?: readonly InkPoint[] },
): number[][] {
  const points = ahead.length > 0 ? [...stroke.points, ...ahead] : stroke.points;
  return getStroke(points, {
    size: stroke.size,
    thinning: 0.55,
    smoothing: 0.5,
    streamline: 0.35,
    simulatePressure: pressureless(stroke.points),
    last: done,
  });
}

/** A coordinate to two decimals, which is finer than any screen shows. */
const f = (v: number) => Math.round(v * 100) / 100;

/** An outline as SVG path data: a closed shape through its midpoints, with quadratic curves. */
export function outlinePath(outline: readonly number[][]): string {
  const n = outline.length;
  if (n === 0) return "";
  const at = (i: number) => outline[i % n] ?? [0, 0];
  const [x0 = 0, y0 = 0] = at(0);
  const parts = [`M${f(x0)},${f(y0)}Q`];
  for (let i = 0; i < n; i++) {
    const [ax = 0, ay = 0] = at(i);
    const [bx = 0, by = 0] = at(i + 1);
    parts.push(`${f(ax)},${f(ay)} ${f((ax + bx) / 2)},${f((ay + by) / 2)} `);
  }
  parts.push("Z");
  return parts.join("");
}

/** A finished Stroke's SVG path data. */
export function strokePath(stroke: Stroke): string {
  return outlinePath(strokeOutline(stroke, { done: true }));
}

/** The parts of a pointer event a pen sample is read from. */
export type PenSample = { clientX: number; clientY: number; pressure: number };

/** A pointer event's own samples, where the browser has the API for them. */
export type SampledEvent = PenSample & {
  getCoalescedEvents?: () => readonly PenSample[];
  getPredictedEvents?: () => readonly PenSample[];
};

/**
 * The samples a pen's pointer event carries, in Canvas units: `kept`, every
 * coalesced sample since the last event (the event itself where the browser
 * has none), and `ahead`, the predicted ones, which are drawn and never kept.
 * `origin` is the viewport's top-left on screen.
 */
export function penSamples(
  event: SampledEvent,
  view: View,
  origin: Point,
): { kept: InkPoint[]; ahead: InkPoint[] } {
  const point = (s: PenSample): InkPoint => {
    const c = toCanvas(view, { x: s.clientX - origin.x, y: s.clientY - origin.y });
    return [c.x, c.y, s.pressure];
  };
  const coalesced =
    typeof event.getCoalescedEvents === "function" ? event.getCoalescedEvents() : [];
  const predicted =
    typeof event.getPredictedEvents === "function" ? event.getPredictedEvents() : [];
  return {
    kept: (coalesced.length > 0 ? coalesced : [event]).map(point),
    ahead: predicted.map(point),
  };
}

/** How faint the grid is at `zoom`: whole from 50%, fading out towards 25%. */
export function gridOpacity(zoom: number): number {
  return zoom >= 0.5 ? 1 : clamp((zoom - ZOOM.min) / (0.5 - ZOOM.min), 0, 1) * 0.8 + 0.2;
}
