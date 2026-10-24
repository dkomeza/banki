import { describe, expect, test } from "bun:test";
import { type ExpiringToken, TokenCache } from "./token-cache";

// The installation token the broker hands every `gh` call and every git push.
// GitHub's last an hour; the broker mints a new one when under 15 minutes
// remain, so whoever gets one has at least that long to use it.

/** What a promise rejects with, or undefined when it resolves. */
const failure = (promise: Promise<unknown>) =>
  promise.then(
    () => undefined,
    (error: unknown) => error,
  );

const START = new Date("2026-10-23T12:00:00.000Z");
const minutes = (n: number) => n * 60_000;

/** A clock to move by hand, and a mint that counts its calls and gives an hour-long token each time. */
function setup() {
  let now = START;
  let minted = 0;
  const failures: Error[] = [];
  const mint = async (): Promise<ExpiringToken> => {
    const next = failures.shift();
    if (next !== undefined) throw next;
    minted++;
    return { token: `token-${minted}`, expiresAt: new Date(now.getTime() + minutes(60)) };
  };
  const cache = new TokenCache(mint, () => now);
  return {
    cache,
    advance: (ms: number) => {
      now = new Date(now.getTime() + ms);
    },
    minted: () => minted,
    failNext: (error: Error) => failures.push(error),
  };
}

describe("the installation token cache", () => {
  test("mints the first token when asked", async () => {
    const { cache, minted } = setup();

    expect((await cache.get()).token).toBe("token-1");
    expect(minted()).toBe(1);
  });

  test("hands out the same token while more than 15 minutes of it remain", async () => {
    const { cache, advance, minted } = setup();
    await cache.get();

    advance(minutes(44));

    expect((await cache.get()).token).toBe("token-1");
    expect(minted()).toBe(1);
  });

  test("mints a new one once 15 minutes or less remain", async () => {
    const { cache, advance } = setup();
    await cache.get();

    advance(minutes(45));

    expect((await cache.get()).token).toBe("token-2");
  });

  test("mints once for callers who ask at the same time", async () => {
    const { cache, minted } = setup();

    const tokens = await Promise.all([cache.get(), cache.get(), cache.get()]);

    expect(tokens.map((t) => t.token)).toEqual(["token-1", "token-1", "token-1"]);
    expect(minted()).toBe(1);
  });

  test("keeps handing out the old token while it is still good, when minting a new one fails", async () => {
    const { cache, advance, failNext } = setup();
    await cache.get();
    advance(minutes(50));
    failNext(new Error("GitHub is down"));

    expect((await cache.get()).token).toBe("token-1");
    // And tries again on the next call.
    expect((await cache.get()).token).toBe("token-2");
  });

  test("fails when minting fails and the old token has under a minute left", async () => {
    const { cache, advance, failNext } = setup();
    await cache.get();
    advance(minutes(59) + 1);
    failNext(new Error("GitHub is down"));

    expect(String(await failure(cache.get()))).toContain("GitHub is down");
  });

  test("fails when the first mint fails, and tries again on the next call", async () => {
    const { cache, failNext } = setup();
    failNext(new Error("bad key"));

    expect(String(await failure(cache.get()))).toContain("bad key");
    expect((await cache.get()).token).toBe("token-1");
  });

  test("never keeps a token minted already within 15 minutes of expiring", async () => {
    let calls = 0;
    const cache = new TokenCache(
      async () => {
        calls++;
        return { token: `short-${calls}`, expiresAt: new Date(START.getTime() + minutes(10)) };
      },
      () => START,
    );

    await cache.get();
    await cache.get();

    expect(calls).toBe(2);
  });
});
