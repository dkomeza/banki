import { describe, expect, test } from "vitest";
import { activeSection, scrollTargets, sectionFromHash } from "./section-index";

describe("scrollTargets", () => {
  test("keeps the jump positions of sections the page can scroll to", () => {
    expect(scrollTargets([0, 500, 900], 2000)).toEqual([0, 500, 900]);
  });

  test("spreads sections that can't reach the top evenly up to the maximum scroll", () => {
    // The last two would both stop at the bottom, 600.
    expect(scrollTargets([0, 500, 900, 1000], 600)).toEqual([0, 500, 550, 600]);
    expect(scrollTargets([0, 700, 900], 600)).toEqual([0, 300, 600]);
  });

  test("spreads sections that share a position, such as cards side by side", () => {
    expect(scrollTargets([0, 400, 400, 900], 2000)).toEqual([0, 200, 400, 900]);
  });

  test("never puts a section before the one above it", () => {
    expect(scrollTargets([0, 400, 300], 2000)).toEqual([0, 200, 400]);
  });
});

describe("activeSection", () => {
  const targets = [0, 500, 550, 600];

  test("tracks each section in turn while scrolling", () => {
    expect([0, 498, 500, 548, 550, 598, 600].map((y) => activeSection(targets, y))).toEqual([
      0, 0, 1, 1, 2, 2, 3,
    ]);
  });

  test("counts a section as reached a pixel early, for rounding", () => {
    expect(activeSection(targets, 499.5)).toBe(1);
  });
});

describe("sectionFromHash", () => {
  const ids = ["study-day", "account", "this-device"];

  test("names the section a hash links to", () => {
    expect(sectionFromHash("#account", ids)).toBe("account");
    expect(sectionFromHash("this-device", ids)).toBe("this-device");
    expect(sectionFromHash("#%61ccount", ids)).toBe("account");
  });

  test.each(["", "#", "#nowhere", "#%", "#%E0%A4%A"])("names no section for %j", (hash) => {
    expect(sectionFromHash(hash, ids)).toBeUndefined();
  });
});
