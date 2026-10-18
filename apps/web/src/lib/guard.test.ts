import { describe, expect, test } from "vitest";
import { guardRedirect } from "./guard";

const at = (href: string) => {
  const url = new URL(href, "http://banki.test");
  return { pathname: url.pathname, href: `${url.pathname}${url.search}${url.hash}` };
};

describe("guardRedirect", () => {
  describe("before Setup", () => {
    test.each(["/", "/login", "/decks/42", "/login?redirect=%2Fdecks"])(
      "sends %s to /setup",
      (href) => {
        expect(guardRedirect({ ...at(href), setUp: false, signedIn: false })).toBe("/setup");
      },
    );

    test("lets /setup through, keeping its token", () => {
      expect(guardRedirect({ ...at("/setup?token=abc"), setUp: false, signedIn: false })).toBe(
        undefined,
      );
    });
  });

  describe("after Setup", () => {
    test("sends /setup to /login when signed out and to / when signed in", () => {
      expect(guardRedirect({ ...at("/setup"), setUp: true, signedIn: false })).toBe("/login");
      expect(guardRedirect({ ...at("/setup"), setUp: true, signedIn: true })).toBe("/");
    });

    test("sends a signed-out browser to /login, coming back to where it was", () => {
      expect(guardRedirect({ ...at("/decks/42?tab=cards"), setUp: true, signedIn: false })).toBe(
        "/login?redirect=%2Fdecks%2F42%3Ftab%3Dcards",
      );
      expect(guardRedirect({ ...at("/"), setUp: true, signedIn: false })).toBe("/login");
    });

    test("lets a signed-out browser onto /login", () => {
      expect(guardRedirect({ ...at("/login"), setUp: true, signedIn: false })).toBe(undefined);
    });

    test("sends a signed-in browser on /login to its redirect target, or /", () => {
      const onLogin = { ...at("/login"), setUp: true, signedIn: true };
      expect(guardRedirect({ ...onLogin, redirect: "/decks/42" })).toBe("/decks/42");
      expect(guardRedirect(onLogin)).toBe("/");
      expect(guardRedirect({ ...onLogin, redirect: "//evil.example" })).toBe("/");
    });

    test("lets a signed-in browser anywhere else", () => {
      expect(guardRedirect({ ...at("/decks/42"), setUp: true, signedIn: true })).toBe(undefined);
    });
  });
});
