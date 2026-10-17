import { describe, expect, test } from "vitest";
import { loginHref, safeRedirect } from "./redirect";

describe("safeRedirect", () => {
  test.each(["/", "/decks", "/decks/42?tab=cards#top", "/a//b"])("follows the path %s", (path) => {
    expect(safeRedirect(path)).toBe(path);
  });

  test.each([
    ["another origin", "https://evil.example/decks"],
    ["a protocol-relative URL", "//evil.example/decks"],
    ["a backslash URL browsers read as protocol-relative", "/\\evil.example"],
    ["a javascript: URL", "javascript:alert(1)"],
    ["a tab that browsers drop, making it protocol-relative", "/\t/evil.example"],
    ["a newline", "/\n/evil.example"],
    ["a relative path", "decks"],
    ["an empty string", ""],
    ["no redirect at all", undefined],
    ["a number", 42],
  ])("goes to / instead of %s", (_, target) => {
    expect(safeRedirect(target)).toBe("/");
  });
});

describe("loginHref", () => {
  test("sends the current path along as redirect", () => {
    expect(loginHref("/decks/42?tab=cards")).toBe("/login?redirect=%2Fdecks%2F42%3Ftab%3Dcards");
  });

  test("leaves redirect out for the home page", () => {
    expect(loginHref("/")).toBe("/login");
  });
});
