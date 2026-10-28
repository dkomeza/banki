import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";
import { isKatexCss, woff2Only } from "./katex-fonts.ts";

const path = createRequire(import.meta.url).resolve("katex/dist/katex.min.css");
const css = readFileSync(path, "utf8");

describe("woff2Only", () => {
  test("leaves each of KaTeX's fonts with its woff2 source alone", () => {
    const out = woff2Only(css);
    const faces = out.match(/@font-face\{[^}]*\}/g) ?? [];
    expect(faces.length).toBeGreaterThan(0);
    for (const face of faces) {
      expect(face).toMatch(/src:url\([^)]+\.woff2\) format\("woff2"\)\}/);
    }
    expect(out).not.toMatch(/\.woff\)|\.ttf\)/);
  });
});

describe("isKatexCss", () => {
  test("matches KaTeX's stylesheet, with or without a query", () => {
    expect(isKatexCss(path)).toBe(true);
    expect(isKatexCss(`${path}?direct`)).toBe(true);
    expect(isKatexCss("/app/src/index.css")).toBe(false);
  });
});
