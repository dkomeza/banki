import { describe, expect, test } from "bun:test";
import {
  imageTag,
  isSlug,
  prFromHost,
  prFromProjectName,
  previewHost,
  previewUrl,
  projectName,
  slugFromHost,
  slugFromProjectName,
  webContainerName,
} from "./naming";

// A Preview's key is its PR number or its Slug; every name is built from it
// and parsed back, so a PR Preview's names and a Slug Preview's never meet.

const GOOD_SLUGS = ["ab", "blue", "a1", "proto-blue-2", "x-y-z", "a".repeat(40), "pr5"];

const BAD_SLUGS = [
  "",
  "a",
  "a".repeat(41),
  "Blue",
  "1blue",
  "-blue",
  "blue-",
  "a--b",
  "blue_green",
  "blue.green",
  "blue green",
  "pr-5",
  "pr-blue",
  "www",
  "api",
  "app",
  "admin",
  "auth",
  "mail",
  "status",
  "preview",
  "previews",
  "prod",
  "production",
  "staging",
  "banki",
  "runner",
];

describe("a Slug", () => {
  for (const slug of GOOD_SLUGS) {
    test(`may be ${JSON.stringify(slug)}`, () => {
      expect(isSlug(slug)).toBe(true);
    });
  }

  for (const slug of BAD_SLUGS) {
    test(`may not be ${JSON.stringify(slug)}`, () => {
      expect(isSlug(slug)).toBe(false);
    });
  }
});

describe("a Slug Preview's names", () => {
  test("are banki-slug-<slug> in Docker and Pangolin, at <slug>.banki.dkomeza.com", () => {
    expect(projectName("blue")).toBe("banki-slug-blue");
    expect(webContainerName("blue")).toBe("banki-slug-blue-web-1");
    expect(previewHost("blue")).toBe("blue.banki.dkomeza.com");
    expect(previewUrl("blue")).toBe("https://blue.banki.dkomeza.com");
    expect(imageTag("blue", "a".repeat(40))).toBe(`slug-blue-${"a".repeat(40)}`);
  });

  test("leave a PR Preview's as they were", () => {
    expect(projectName(5)).toBe("banki-pr-5");
    expect(webContainerName(5)).toBe("banki-pr-5-web-1");
    expect(previewUrl(5)).toBe("https://pr-5.banki.dkomeza.com");
    expect(imageTag(5, "a".repeat(40))).toBe(`pr-5-${"a".repeat(40)}`);
  });

  test("are parsed back from a project's name, and only from a valid Slug's", () => {
    expect(slugFromProjectName("banki-slug-blue")).toBe("blue");
    for (const name of ["banki-pr-5", "banki-slug-", "banki-slug-www", "banki-slug-Blue", "x"]) {
      expect(slugFromProjectName(name)).toBeUndefined();
    }
    expect(prFromProjectName("banki-slug-blue")).toBeUndefined();
  });

  test("are parsed back from the exact host only", () => {
    expect(slugFromHost("blue.banki.dkomeza.com")).toBe("blue");
    for (const host of [
      "pr-5.banki.dkomeza.com",
      "www.banki.dkomeza.com",
      "x.blue.banki.dkomeza.com",
      "blue.banki.dkomeza.com.evil",
      "blue.example.com",
      "banki.dkomeza.com",
      ".banki.dkomeza.com",
    ]) {
      expect(slugFromHost(host)).toBeUndefined();
    }
    expect(prFromHost("blue.banki.dkomeza.com")).toBeUndefined();
  });
});
