import { describe, expect, test } from "vitest";
import {
  type InkPoint,
  type Stroke,
  type View,
  FIT_MARGIN,
  INK_SIZE,
  START_VIEW,
  ZOOM,
  fit,
  gridOpacity,
  inkBounds,
  outlinePath,
  panBy,
  penSamples,
  pinch,
  pressureless,
  strokeBounds,
  strokeOutline,
  strokePath,
  toCanvas,
  toScreen,
  union,
  viewTransform,
  wheelPan,
  wheelPixels,
  wheelZoom,
  zoomAbout,
  zoomStep,
} from "./ink";

const stroke = (points: InkPoint[], size = 4): Stroke => ({ points, size });

/** A straight Stroke of 20 samples, all at pressure `p`. */
const line = (p: number): Stroke =>
  stroke(Array.from({ length: 20 }, (_, i): InkPoint => [i * 5, 0, p]));

/** How tall an outline is. */
const height = (s: Stroke) => {
  const ys = strokeOutline(s, { done: true }).map(([, y = 0]) => y);
  return Math.max(...ys) - Math.min(...ys);
};

/** How far right an outline reaches. */
const reach = (outline: number[][]) => Math.max(...outline.map(([x = 0]) => x));

describe("the view", () => {
  test("starts at 100% with the Canvas's origin at the top-left", () => {
    expect(START_VIEW).toEqual({ x: 0, y: 0, zoom: 1 });
    expect(viewTransform(START_VIEW)).toBe("translate(0px, 0px) scale(1)");
  });

  test("maps the screen to the Canvas and back", () => {
    const view: View = { x: 40, y: -20, zoom: 2 };
    expect(toCanvas(view, { x: 140, y: 80 })).toEqual({ x: 50, y: 50 });
    expect(toScreen(view, { x: 50, y: 50 })).toEqual({ x: 140, y: 80 });
    expect(viewTransform(view)).toBe("translate(40px, -20px) scale(2)");
  });

  test("pans by screen px, in every direction, with no edges", () => {
    expect(panBy(START_VIEW, -500, 300)).toEqual({ x: -500, y: 300, zoom: 1 });
    expect(panBy({ x: 10, y: 10, zoom: 3 }, 5, -5)).toEqual({ x: 15, y: 5, zoom: 3 });
  });

  test("zooms about a point, which stays where it is on screen", () => {
    const view: View = { x: 30, y: 10, zoom: 1 };
    const about = { x: 200, y: 150 };
    const before = toCanvas(view, about);
    const zoomed = zoomAbout(view, 2, about);
    expect(zoomed.zoom).toBe(2);
    expect(toScreen(zoomed, before).x).toBeCloseTo(about.x);
    expect(toScreen(zoomed, before).y).toBeCloseTo(about.y);
  });

  test("keeps the zoom within 25% to 400%", () => {
    expect(zoomAbout(START_VIEW, 0.1, { x: 0, y: 0 }).zoom).toBe(ZOOM.min);
    expect(zoomAbout(START_VIEW, 10, { x: 0, y: 0 }).zoom).toBe(ZOOM.max);
    expect(ZOOM).toEqual({ min: 0.25, max: 4, step: 1.25 });
  });

  test("− and + step by 1.25× about the viewport's centre", () => {
    const size = { w: 800, h: 600 };
    const centre = toCanvas(START_VIEW, { x: 400, y: 300 });
    const plus = zoomStep(START_VIEW, 1, size);
    expect(plus.zoom).toBeCloseTo(1.25);
    expect(toScreen(plus, centre).x).toBeCloseTo(400);
    expect(toScreen(plus, centre).y).toBeCloseTo(300);
    expect(zoomStep(START_VIEW, -1, size).zoom).toBeCloseTo(0.8);
    expect(zoomStep({ x: 0, y: 0, zoom: 4 }, 1, size).zoom).toBe(4);
  });

  test("a pinch zooms by how far the fingers spread and pans with their midpoint", () => {
    const from: [{ x: number; y: number }, { x: number; y: number }] = [
      { x: 100, y: 100 },
      { x: 200, y: 100 },
    ];
    // Twice as far apart, and both moved 50 px down.
    const to: typeof from = [
      { x: 50, y: 150 },
      { x: 250, y: 150 },
    ];
    const view = pinch(START_VIEW, from, to);
    expect(view.zoom).toBe(2);
    // The paper under the fingers' midpoint (150, 100) is now under (150, 150).
    expect(toScreen(view, { x: 150, y: 100 })).toEqual({ x: 150, y: 150 });
  });

  test("a pinch stays within the zoom's range", () => {
    const from: [{ x: number; y: number }, { x: number; y: number }] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];
    expect(pinch(START_VIEW, from, [from[0], { x: 1000, y: 0 }]).zoom).toBe(4);
    expect(pinch(START_VIEW, from, [from[0], { x: 1, y: 0 }]).zoom).toBe(0.25);
  });
});

describe("the wheel", () => {
  test("a notch of a mouse wheel zooms by about 1.25×, in either direction", () => {
    expect(wheelZoom(-100)).toBeCloseTo(1.25, 1);
    expect(wheelZoom(100)).toBeCloseTo(0.8, 1);
    expect(wheelZoom(-100) * wheelZoom(100)).toBeCloseTo(1);
    expect(wheelZoom(0)).toBe(1);
  });

  test("pans against the scroll, and across with Shift", () => {
    expect(wheelPan(0, 40, false)).toEqual({ x: -0, y: -40 });
    expect(wheelPan(30, 0, false)).toEqual({ x: -30, y: -0 });
    expect(wheelPan(0, 40, true)).toEqual({ x: -40, y: 0 });
    // A trackpad's own sideways scroll with Shift stays as it is.
    expect(wheelPan(25, 5, true)).toEqual({ x: -25, y: -5 });
  });

  test("reads lines and pages as px", () => {
    expect(wheelPixels(3, 0, 600)).toBe(3);
    expect(wheelPixels(3, 1, 600)).toBe(48);
    expect(wheelPixels(1, 2, 600)).toBe(600);
  });
});

describe("bounds and Fit", () => {
  test("a Stroke's bounds take in its thickness", () => {
    expect(
      strokeBounds(
        stroke(
          [
            [10, 20, 0.5],
            [30, 5, 0.5],
          ],
          4,
        ),
      ),
    ).toEqual({ x: 8, y: 3, w: 24, h: 19 });
    expect(strokeBounds(stroke([]))).toBeNull();
  });

  test("the Ink's bounds take in every Stroke, and are null with none", () => {
    expect(inkBounds([])).toBeNull();
    expect(
      inkBounds([stroke([[0, 0, 0.5]], 2), stroke([[100, 50, 0.5]], 2), stroke([], 2)]),
    ).toEqual({ x: -1, y: -1, w: 102, h: 52 });
  });

  test("union skips nulls", () => {
    expect(union([null, null])).toBeNull();
    expect(union([{ x: 0, y: 0, w: 10, h: 10 }, null, { x: -5, y: 20, w: 5, h: 5 }])).toEqual({
      x: -5,
      y: 0,
      w: 15,
      h: 25,
    });
  });

  test("Fit frames the content with a 24 px margin, centred", () => {
    const size = { w: 848, h: 648 };
    const view = fit({ x: 100, y: 100, w: 400, h: 100 }, size);
    // 800 px of room across for 400: 200%.
    expect(view.zoom).toBe(2);
    const tl = toScreen(view, { x: 100, y: 100 });
    const br = toScreen(view, { x: 500, y: 200 });
    expect(tl.x).toBe(FIT_MARGIN);
    expect(br.x).toBe(848 - FIT_MARGIN);
    // Centred down.
    expect((tl.y + br.y) / 2).toBe(324);
  });

  test("Fit stays within the zoom's range", () => {
    const size = { w: 800, h: 600 };
    expect(fit({ x: 0, y: 0, w: 10, h: 10 }, size).zoom).toBe(4);
    expect(fit({ x: 0, y: 0, w: 100_000, h: 10 }, size).zoom).toBe(0.25);
    expect(fit({ x: 0, y: 0, w: 0, h: 0 }, size).zoom).toBe(4);
  });
});

describe("Strokes", () => {
  test("are points of x, y and pressure, at Medium in Canvas units", () => {
    expect(INK_SIZE.medium).toBe(4);
  });

  test("a pen with no pressure of its own gets it simulated", () => {
    expect(
      pressureless([
        [0, 0, 0.5],
        [1, 1, 0.5],
      ]),
    ).toBe(true);
    expect(
      pressureless([
        [0, 0, 0],
        [1, 1, 0],
      ]),
    ).toBe(true);
    expect(
      pressureless([
        [0, 0, 0.3],
        [1, 1, 0.7],
      ]),
    ).toBe(false);
  });

  test("the outline is pressure-sensitive: a harder Stroke is wider", () => {
    expect(height(line(0.9))).toBeGreaterThan(height(line(0.2)));
  });

  test("predicted samples reach further, and the Stroke keeps only its own", () => {
    const s = stroke(Array.from({ length: 10 }, (_, i): InkPoint => [i * 5, 0, 0.6]));
    const ahead: InkPoint[] = [
      [60, 0, 0.6],
      [70, 0, 0.6],
    ];
    expect(reach(strokeOutline(s, { done: false, ahead }))).toBeGreaterThan(
      reach(strokeOutline(s, { done: false })),
    );
    expect(s.points).toHaveLength(10);
  });

  test("a tap makes a dot", () => {
    expect(strokePath(stroke([[10, 10, 0.5]]))).toMatch(/^M[\d.,]+Q.+Z$/);
  });

  test("an outline becomes closed SVG path data", () => {
    expect(
      outlinePath([
        [0, 0],
        [10, 0],
        [10, 10],
      ]),
    ).toBe("M0,0Q0,0 5,0 10,0 10,5 10,10 5,5 Z");
    expect(outlinePath([])).toBe("");
  });
});

describe("pen samples", () => {
  const view: View = { x: 10, y: 0, zoom: 2 };
  const origin = { x: 100, y: 50 };

  test("are read in Canvas units from the event where there are no coalesced ones", () => {
    expect(penSamples({ clientX: 130, clientY: 70, pressure: 0.4 }, view, origin)).toEqual({
      kept: [[10, 10, 0.4]],
      ahead: [],
    });
  });

  test("keep every coalesced sample, and the predicted ones only ahead", () => {
    const event = {
      clientX: 150,
      clientY: 90,
      pressure: 0.6,
      getCoalescedEvents: () => [
        { clientX: 130, clientY: 70, pressure: 0.4 },
        { clientX: 150, clientY: 90, pressure: 0.6 },
      ],
      getPredictedEvents: () => [{ clientX: 170, clientY: 110, pressure: 0.6 }],
    };
    expect(penSamples(event, view, origin)).toEqual({
      kept: [
        [10, 10, 0.4],
        [20, 20, 0.6],
      ],
      ahead: [[30, 30, 0.6]],
    });
  });

  test("fall back to the event when the browser coalesces nothing", () => {
    const event = {
      clientX: 130,
      clientY: 70,
      pressure: 0.5,
      getCoalescedEvents: () => [],
      getPredictedEvents: () => [],
    };
    expect(penSamples(event, view, origin).kept).toEqual([[10, 10, 0.5]]);
  });
});

describe("the grid", () => {
  test("is whole from 50%, and fades below it", () => {
    expect(gridOpacity(1)).toBe(1);
    expect(gridOpacity(0.5)).toBe(1);
    expect(gridOpacity(0.375)).toBeLessThan(1);
    expect(gridOpacity(0.25)).toBeLessThan(gridOpacity(0.375));
    expect(gridOpacity(0.25)).toBeGreaterThan(0);
  });
});
