import { describe, expect, test } from "bun:test";
import { createSetupToken } from "./setup-token";

describe("createSetupToken", () => {
  test("is at least 128 bits of base64url randomness, fresh every time", () => {
    const first = createSetupToken();
    const second = createSetupToken();

    expect(first.value).toMatch(/^[\w-]{43}$/);
    expect(first.value).not.toBe(second.value);
  });

  test("matches only its own value", () => {
    const token = createSetupToken();

    expect(token.matches(token.value)).toBe(true);
    expect(token.matches(createSetupToken().value)).toBe(false);
    expect(token.matches(token.value.slice(1))).toBe(false);
    expect(token.matches("")).toBe(false);
  });

  test("matches nothing once discarded", () => {
    const token = createSetupToken();
    const { value } = token;

    token.discard();

    expect(token.matches(value)).toBe(false);
  });
});
