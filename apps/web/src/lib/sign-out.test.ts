import { describe, expect, test, vi } from "vitest";
import { memoryStorage } from "./memory-storage";
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

  test("clears every Deck's stored study Session, and leaves the rest of storage", async () => {
    const storage = memoryStorage({
      "banki.session.d1": "{}",
      "banki.session.d2": "{}",
      "banki.theme": "dark",
    });

    await signOut(async () => ({ error: null }), vi.fn(), storage);

    expect([...storage.map.keys()]).toEqual(["banki.theme"]);
  });

  test("keeps the stored Sessions when signing out fails", async () => {
    const storage = memoryStorage({ "banki.session.d1": "{}" });

    await signOut(async () => ({ error: { status: 403 } }), vi.fn(), storage);

    expect([...storage.map.keys()]).toEqual(["banki.session.d1"]);
  });
});
