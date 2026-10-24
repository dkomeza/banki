import { describe, expect, test } from "bun:test";
import { LinearTokens, MAX_AGE_MS } from "./linear-tokens";

// The Linear tokens the broker issues, one per Stage: minted with the
// client-credentials grant when the Stage starts, revoked when it ends, and
// revoked anyway 4 hours after issue, which covers a Stage that crashed.

/** What a promise rejects with, or undefined when it resolves. */
const failure = (promise: Promise<unknown>) =>
  promise.then(
    () => undefined,
    (error: unknown) => error,
  );

const START = new Date("2026-10-23T01:00:00.000Z");
const hours = (n: number) => n * 3_600_000;

function setup() {
  let now = START;
  let minted = 0;
  const revoked: string[] = [];
  const failRevoke = new Set<string>();
  const tokens = new LinearTokens({
    mint: async () => `linear-${++minted}`,
    revoke: async (token) => {
      if (failRevoke.has(token)) throw new Error("Linear is down");
      revoked.push(token);
    },
    now: () => now,
    newId: () => `id-${minted}`,
  });
  return {
    tokens,
    revoked,
    failRevoke,
    advance: (ms: number) => {
      now = new Date(now.getTime() + ms);
    },
  };
}

describe("the Linear tokens", () => {
  test("are revoked 4 hours after issue", () => {
    expect(MAX_AGE_MS).toBe(hours(4));
  });

  test("a new one is minted for each Stage, with an ID to end it by and when it will be revoked", async () => {
    const { tokens } = setup();

    const first = await tokens.issue();
    const second = await tokens.issue();

    expect(first).toEqual({
      id: "id-1",
      token: "linear-1",
      revokeAt: new Date(START.getTime() + hours(4)),
    });
    expect(second.token).toBe("linear-2");
    expect(tokens.live()).toBe(2);
  });

  test("ending a Stage revokes its token and forgets it", async () => {
    const { tokens, revoked } = setup();
    const { id } = await tokens.issue();

    expect(await tokens.end(id)).toBe("revoked");

    expect(revoked).toEqual(["linear-1"]);
    expect(tokens.live()).toBe(0);
  });

  test("ending an ID it never issued, or one already ended, revokes nothing", async () => {
    const { tokens, revoked } = setup();
    const { id } = await tokens.issue();
    await tokens.end(id);

    expect(await tokens.end(id)).toBe("unknown");
    expect(await tokens.end("made-up")).toBe("unknown");
    expect(revoked).toEqual(["linear-1"]);
  });

  test("a revoke that fails at the end keeps the token, for the sweep to try again", async () => {
    const { tokens, revoked, failRevoke, advance } = setup();
    const { id } = await tokens.issue();
    failRevoke.add("linear-1");

    expect(String(await failure(tokens.end(id)))).toContain("Linear is down");
    expect(tokens.live()).toBe(1);

    failRevoke.clear();
    advance(hours(4));
    await tokens.sweep();
    expect(revoked).toEqual(["linear-1"]);
    expect(tokens.live()).toBe(0);
  });

  test("the sweep leaves a token younger than 4 hours alone", async () => {
    const { tokens, revoked, advance } = setup();
    await tokens.issue();

    advance(hours(4) - 1);
    await tokens.sweep();

    expect(revoked).toEqual([]);
    expect(tokens.live()).toBe(1);
  });

  test("the sweep revokes every token 4 hours old or more, even if nobody asked", async () => {
    const { tokens, revoked, advance } = setup();
    await tokens.issue();
    advance(hours(1));
    await tokens.issue();
    advance(hours(3));
    await tokens.issue();

    const swept = await tokens.sweep();

    expect(swept).toEqual({ revoked: ["id-1"], failed: [] });
    expect(revoked).toEqual(["linear-1"]);
    expect(tokens.live()).toBe(2);

    advance(hours(1));
    await tokens.sweep();
    expect(revoked).toEqual(["linear-1", "linear-2"]);
  });

  test("a revoke that fails in the sweep doesn't stop the others, and is tried again on the next one", async () => {
    const { tokens, revoked, failRevoke, advance } = setup();
    await tokens.issue();
    await tokens.issue();
    failRevoke.add("linear-1");
    advance(hours(5));

    expect(await tokens.sweep()).toEqual({
      revoked: ["id-2"],
      failed: [{ id: "id-1", error: "Linear is down" }],
    });
    expect(revoked).toEqual(["linear-2"]);

    failRevoke.clear();
    expect(await tokens.sweep()).toEqual({ revoked: ["id-1"], failed: [] });
  });

  test("a mint that fails issues nothing", async () => {
    const tokens = new LinearTokens({
      mint: () => Promise.reject(new Error("bad secret")),
      revoke: async () => undefined,
    });

    expect(String(await failure(tokens.issue()))).toContain("bad secret");
    expect(tokens.live()).toBe(0);
  });

  test("the live tokens are listed for redaction", async () => {
    const { tokens } = setup();
    await tokens.issue();
    await tokens.issue();

    expect(tokens.values()).toEqual(["linear-1", "linear-2"]);
  });
});
