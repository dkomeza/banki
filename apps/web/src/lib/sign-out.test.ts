import { describe, expect, test, vi } from "vitest";
import { signOut } from "./sign-out";

describe("signOut", () => {
  test("goes to sign-in when better-auth signed the browser out", async () => {
    const signedOut = vi.fn();

    await expect(signOut(async () => ({ error: null }), signedOut)).resolves.toBe(true);
    expect(signedOut).toHaveBeenCalledTimes(1);
  });

  test("stays put when better-auth answers with an error", async () => {
    const signedOut = vi.fn();

    const ok = await signOut(
      async () => ({ error: { status: 403, message: "Invalid origin" } }),
      signedOut,
    );

    expect(ok).toBe(false);
    expect(signedOut).not.toHaveBeenCalled();
  });

  test("stays put when the request fails outright", async () => {
    const signedOut = vi.fn();

    const ok = await signOut(async () => {
      throw new TypeError("Failed to fetch");
    }, signedOut);

    expect(ok).toBe(false);
    expect(signedOut).not.toHaveBeenCalled();
  });
});
