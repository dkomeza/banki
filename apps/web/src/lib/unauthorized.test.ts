import { describe, expect, test, vi } from "vitest";
import { createUnauthorizedHandler, handlingUnauthorized } from "./unauthorized";

/** A promise and the function that resolves it. */
function deferred<T>() {
  let resolve: ((value: T) => void) | undefined;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve: (value: T) => resolve?.(value) };
}

const answering = (status: number): typeof fetch =>
  vi.fn(async () => new Response(null, { status }));

describe("a 401 from an API call", () => {
  test("re-checks the sign-in once and goes to sign-in when signed out", async () => {
    const isSignedIn = vi.fn(async () => false);
    const goToSignIn = vi.fn();
    const fetch = handlingUnauthorized(
      answering(401),
      createUnauthorizedHandler({ isSignedIn, goToSignIn }),
    );

    const res = await fetch("/api/me");

    expect(res.status).toBe(401);
    expect(isSignedIn).toHaveBeenCalledTimes(1);
    expect(goToSignIn).toHaveBeenCalledTimes(1);
  });

  test("stays put when still signed in, handing the 401 back to show as an error", async () => {
    const isSignedIn = vi.fn(async () => true);
    const goToSignIn = vi.fn();
    const inner = answering(401);
    const fetch = handlingUnauthorized(
      inner,
      createUnauthorizedHandler({ isSignedIn, goToSignIn }),
    );

    const res = await fetch("/api/me");

    expect(res.status).toBe(401);
    expect(isSignedIn).toHaveBeenCalledTimes(1);
    expect(goToSignIn).not.toHaveBeenCalled();
    // The request isn't retried, so nothing loops.
    expect(inner).toHaveBeenCalledTimes(1);
  });

  test("shares one re-check between 401s that arrive together", async () => {
    const check = deferred<boolean>();
    const isSignedIn = vi.fn(() => check.promise);
    const goToSignIn = vi.fn();
    const fetch = handlingUnauthorized(
      answering(401),
      createUnauthorizedHandler({ isSignedIn, goToSignIn }),
    );

    const both = Promise.all([fetch("/api/me"), fetch("/api/decks")]);
    await vi.waitFor(() => expect(isSignedIn).toHaveBeenCalled());
    check.resolve(false);
    await both;

    expect(isSignedIn).toHaveBeenCalledTimes(1);
    expect(goToSignIn).toHaveBeenCalledTimes(1);
  });

  test("re-checks again for a later 401", async () => {
    const isSignedIn = vi.fn(async () => true);
    const fetch = handlingUnauthorized(
      answering(401),
      createUnauthorizedHandler({ isSignedIn, goToSignIn: vi.fn() }),
    );

    await fetch("/api/me");
    await fetch("/api/me");

    expect(isSignedIn).toHaveBeenCalledTimes(2);
  });

  test("stays put when the re-check itself fails", async () => {
    const goToSignIn = vi.fn();
    const fetch = handlingUnauthorized(
      answering(401),
      createUnauthorizedHandler({
        isSignedIn: async () => {
          throw new TypeError("Failed to fetch");
        },
        goToSignIn,
      }),
    );

    expect((await fetch("/api/me")).status).toBe(401);
    expect(goToSignIn).not.toHaveBeenCalled();
  });
});

describe("any other answer", () => {
  test.each([200, 403, 404, 500])("%d doesn't re-check the sign-in", async (status) => {
    const isSignedIn = vi.fn(async () => false);
    const fetch = handlingUnauthorized(
      answering(status),
      createUnauthorizedHandler({ isSignedIn, goToSignIn: vi.fn() }),
    );

    expect((await fetch("/api/me")).status).toBe(status);
    expect(isSignedIn).not.toHaveBeenCalled();
  });
});
