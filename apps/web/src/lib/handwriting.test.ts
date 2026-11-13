import { describe, expect, test } from "vitest";
import {
  FRONT_AT,
  FRONT_SCALE,
  frontWidth,
  handwritingSearch,
  keepOnCanvas,
  scaleFromCorner,
  startScale,
} from "./handwriting";

describe("handwritingSearch", () => {
  test("keeps ?handwriting=1, as a number or as text", () => {
    expect(handwritingSearch({ handwriting: 1 })).toEqual({ handwriting: 1 });
    expect(handwritingSearch({ handwriting: "1" })).toEqual({ handwriting: 1 });
  });

  test("drops anything else", () => {
    expect(handwritingSearch({})).toEqual({});
    expect(handwritingSearch({ handwriting: 0 })).toEqual({});
    expect(handwritingSearch({ handwriting: "yes" })).toEqual({});
    expect(handwritingSearch({ handwriting: true })).toEqual({});
    expect(handwritingSearch({ state: "ink" })).toEqual({});
  });
});

describe("frontWidth", () => {
  test("is 416 px on a canvas from 1000 px wide", () => {
    expect(frontWidth(1000)).toBe(416);
    expect(frontWidth(1440)).toBe(416);
  });

  test("leaves room for the tool bar on a narrower one", () => {
    expect(frontWidth(820)).toBe(740);
    expect(frontWidth(390)).toBe(310);
  });

  test("is never narrower than 240 px", () => {
    expect(frontWidth(200)).toBe(240);
  });
});

describe("startScale", () => {
  test("is 100% for a Front that fits", () => {
    expect(startScale({ natural: 120, canvasHeight: 800, kept: null })).toBe(1);
  });

  test("scales a long Front down to 60% of the canvas's height", () => {
    expect(startScale({ natural: 1000, canvasHeight: 800, kept: null })).toBeCloseTo(0.48);
  });

  test("never below 40%", () => {
    expect(startScale({ natural: 4000, canvasHeight: 800, kept: null })).toBe(FRONT_SCALE.min);
  });

  test("starts at the scale the User last chose, unless that is too tall", () => {
    expect(startScale({ natural: 120, canvasHeight: 800, kept: 1.5 })).toBe(1.5);
    expect(startScale({ natural: 1000, canvasHeight: 800, kept: 1.5 })).toBeCloseTo(0.48);
  });

  test("is 100% before the Front or the canvas is measured", () => {
    expect(startScale({ natural: 0, canvasHeight: 800, kept: null })).toBe(1);
    expect(startScale({ natural: 500, canvasHeight: 0, kept: null })).toBe(1);
  });
});

describe("scaleFromCorner", () => {
  const from = { x: 100, y: 100, scale: 1, width: 400, height: 200 };

  test("the bottom-right corner scales about the top-left, which stays put", () => {
    expect(scaleFromCorner(from, "br", 200, 0)).toEqual({ x: 100, y: 100, scale: 1.5 });
  });

  test("takes whichever way the corner moved further", () => {
    expect(scaleFromCorner(from, "br", 20, 100).scale).toBeCloseTo(1.5);
  });

  test("the top-left corner scales about the bottom-right, moving the Front", () => {
    const to = scaleFromCorner(from, "tl", 200, 0);
    expect(to.scale).toBeCloseTo(0.5);
    expect(to.x).toBeCloseTo(300);
    expect(to.y).toBeCloseTo(200);
  });

  test("stops at 40% and 250%", () => {
    expect(scaleFromCorner(from, "br", -1000, 0).scale).toBe(FRONT_SCALE.min);
    expect(scaleFromCorner(from, "br", 5000, 0).scale).toBe(FRONT_SCALE.max);
  });

  test("never moves the Front past the canvas's top or left", () => {
    const to = scaleFromCorner({ ...from, x: 10, y: 10 }, "tl", -400, 0);
    expect(to.x).toBe(0);
    expect(to.y).toBe(0);
  });
});

describe("keepOnCanvas", () => {
  const canvas = { w: 800, h: 600 };

  test("leaves a Front on the canvas where it is", () => {
    expect(keepOnCanvas({ x: 12, y: FRONT_AT.y }, canvas)).toEqual({ x: 12, y: FRONT_AT.y });
  });

  test("never past the top or the left", () => {
    expect(keepOnCanvas({ x: -50, y: -10 }, canvas)).toEqual({ x: 0, y: 0 });
  });

  test("keeps enough of it on the canvas to grab it again", () => {
    expect(keepOnCanvas({ x: 2000, y: 2000 }, canvas)).toEqual({ x: 752, y: 552 });
  });
});
