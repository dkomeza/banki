import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { contrast, readPalette, toHex } from "./palette.ts";

const css = readFileSync(join(import.meta.dirname, "src/index.css"), "utf8");
const palette = readPalette(css);
const THEMES = ["light", "dark"] as const;

describe("readPalette", () => {
  test("evaluates oklch tokens through var() and calc()", () => {
    const { light, dark } = readPalette(`
      :root { --hue: 30; --base: oklch(0.5 0.1 var(--hue)); --bg: oklch(1 0 0); }
      :root { --fg: var(--base); --tint: oklch(0.9 calc(0.1 * 0.5) calc(var(--hue) + 10)); }
      .dark { --bg: oklch(0 0 0); }
    `);

    expect(light["fg"]).toEqual({ l: 0.5, c: 0.1, h: 30, alpha: 1 });
    expect(light["tint"]).toEqual({ l: 0.9, c: 0.05, h: 40, alpha: 1 });
    expect(toHex(light["bg"]!)).toBe("#ffffff");
    expect(toHex(dark["bg"]!)).toBe("#000000");
    expect(dark["fg"]).toEqual(light["fg"]);
  });

  test("converts oklch to sRGB hex", () => {
    // Known values: CSS Color 4's sample conversions.
    expect(toHex({ l: 0.627955, c: 0.257627, h: 29.2339, alpha: 1 })).toBe("#ff0000");
    expect(toHex({ l: 0.519752, c: 0.176858, h: 142.495, alpha: 1 })).toBe("#008000");
  });

  test("measures WCAG contrast", () => {
    const white = { l: 1, c: 0, h: 0, alpha: 1 };
    const black = { l: 0, c: 0, h: 0, alpha: 1 };

    expect(contrast(white, black)).toBeCloseTo(21, 1);
    expect(contrast(white, white)).toBeCloseTo(1, 5);
  });
});

describe("the Paper & ink palette in index.css", () => {
  test("defines every token in both themes, all colours in sRGB", () => {
    for (const theme of THEMES) {
      for (const [name, color] of Object.entries(palette[theme])) {
        expect(toHex(color), `${theme} --${name}`).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
    expect(Object.keys(palette.dark).toSorted()).toEqual(Object.keys(palette.light).toSorted());
  });

  test("is a warm paper with a burnt-orange accent", () => {
    const { background, primary } = palette.light;

    expect(background!.l).toBeGreaterThan(0.95);
    expect(background!.h).toBeGreaterThanOrEqual(60);
    expect(background!.h).toBeLessThanOrEqual(100);
    expect(primary!.h).toBeGreaterThanOrEqual(35);
    expect(primary!.h).toBeLessThanOrEqual(55);
    expect(palette.dark.background!.l).toBeLessThan(0.25);
    expect(palette.dark.primary!.l).toBeGreaterThan(primary!.l);
  });

  test("matches the icon's paper and accent fills", () => {
    const svg = readFileSync(join(import.meta.dirname, "public/icon.svg"), "utf8");
    const fills = new Set([...svg.matchAll(/(?:fill|stroke)="(#[0-9a-f]{6})"/g)].map((m) => m[1]));

    expect(fills).toContain(toHex(palette.light.background!));
    expect(fills).toContain(toHex(palette.light.primary!));
  });

  test("re-colours the accent in both themes from the one accent hue", () => {
    const blue = readPalette(css.replace(/--accent-hue:\s*[\d.]+;/, "--accent-hue: 250;"));

    for (const theme of THEMES) {
      for (const token of ["primary", "ring", "sidebar-primary", "accent", "chart-1"]) {
        expect(blue[theme][token], `${theme} --${token}`).not.toEqual(palette[theme][token]);
      }
      for (const token of ["background", "foreground", "muted-foreground", "border"]) {
        expect(blue[theme][token], `${theme} --${token}`).toEqual(palette[theme][token]);
      }
    }
  });

  // [text, surface] pairs that carry text: AA asks for 4.5:1.
  const TEXT: [string, string][] = [
    ["foreground", "background"],
    ["muted-foreground", "background"],
    ["muted-foreground", "muted"],
    ["muted-foreground", "card"],
    ["muted-foreground", "sidebar"],
    ["card-foreground", "card"],
    ["popover-foreground", "popover"],
    ["muted-foreground", "popover"],
    ["primary-foreground", "primary"],
    ["secondary-foreground", "secondary"],
    ["accent-foreground", "accent"],
    ["primary", "background"],
    ["primary", "card"],
    ["primary", "popover"],
    ["primary", "secondary"],
    ["destructive", "background"],
    ["destructive", "card"],
    ["destructive", "popover"],
    ["sidebar-foreground", "sidebar"],
    ["sidebar-primary", "sidebar"],
    ["sidebar-primary", "sidebar-accent"],
    ["sidebar-accent-foreground", "sidebar-accent"],
    ["sidebar-primary-foreground", "sidebar-primary"],
  ];
  // Control boundaries and focus rings against what they sit on: 3:1.
  const CONTROLS: [string, string][] = [
    ["input", "background"],
    ["input", "card"],
    ["input", "popover"],
    ["ring", "background"],
    ["ring", "card"],
    ["ring", "popover"],
    ["ring", "sidebar"],
    ["primary", "background"],
    // The selected theme choice: its ring against the track it sits in.
    ["primary", "muted"],
  ];

  for (const theme of THEMES) {
    test.each(TEXT)(`${theme}: --%s on --%s meets AA for text`, (text, surface) => {
      expect(contrast(palette[theme][text]!, palette[theme][surface]!)).toBeGreaterThanOrEqual(4.5);
    });
    test.each(CONTROLS)(`${theme}: --%s on --%s meets AA for controls`, (control, surface) => {
      expect(contrast(palette[theme][control]!, palette[theme][surface]!)).toBeGreaterThanOrEqual(
        3,
      );
    });
  }
});
