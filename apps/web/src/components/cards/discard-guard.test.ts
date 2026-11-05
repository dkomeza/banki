import { describe, expect, test } from "vitest";
import { blockedAction } from "./discard-guard";

describe("a navigation the discard guard blocked", () => {
  test("held by a save or a delete on its way, stays unasked", () => {
    expect(blockedAction({ holding: true, unsaved: true, toSignIn: false })).toBe("stay");
    expect(blockedAction({ holding: true, unsaved: false, toSignIn: false })).toBe("stay");
  });

  test("to the sign-in page, asks only while something is unsaved", () => {
    expect(blockedAction({ holding: true, unsaved: true, toSignIn: true })).toBe("ask");
    expect(blockedAction({ holding: false, unsaved: true, toSignIn: true })).toBe("ask");
    expect(blockedAction({ holding: true, unsaved: false, toSignIn: true })).toBe("go");
  });

  test("with something unsaved, asks", () => {
    expect(blockedAction({ holding: false, unsaved: true, toSignIn: false })).toBe("ask");
  });

  test("blocked by a hold that ended as it rendered, with nothing unsaved, goes without asking", () => {
    expect(blockedAction({ holding: false, unsaved: false, toSignIn: false })).toBe("go");
  });
});
