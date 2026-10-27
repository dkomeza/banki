import { describe, expect, test } from "bun:test";
import { HOLD_MS, heldToken } from "./held-token";

// The Dashboard's one Linear token, held 15 minutes and shared by its views.

function setup() {
  let clock = 0;
  let minted = 0;
  const revoked: string[] = [];
  const held = heldToken({
    broker: {
      linearToken: async () => {
        minted += 1;
        return { id: `id-${minted}`, token: `token-${minted}` };
      },
      endLinearToken: async (id) => {
        revoked.push(id);
      },
    },
    now: () => clock,
    log: () => undefined,
  });
  return {
    held,
    revoked,
    minted: () => minted,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe("the Dashboard's held Linear token", () => {
  test("is one token for every view within 15 minutes, never revoked as a view ends", async () => {
    const { held, revoked, minted, advance } = setup();

    const first = await held.linearToken();
    await held.endLinearToken(first.id);
    advance(HOLD_MS - 1);
    const second = await held.linearToken();
    await held.endLinearToken(second.id);

    expect(second).toEqual(first);
    expect(minted()).toBe(1);
    expect(revoked).toEqual([]);
  });

  test("shares one mint between the views that ask at once", async () => {
    const { held, minted } = setup();

    const [a, b] = await Promise.all([held.linearToken(), held.linearToken()]);

    expect(a).toEqual(b);
    expect(minted()).toBe(1);
  });

  test("mints the next after 15 minutes, and revokes the last once no view uses it", async () => {
    const { held, revoked, advance } = setup();
    const old = await held.linearToken();
    advance(HOLD_MS);

    const next = await held.linearToken();

    expect(next.id).toBe("id-2");
    // A view still on the old token keeps it until it ends.
    expect(revoked).toEqual([]);
    await held.endLinearToken(old.id);
    expect(revoked).toEqual(["id-1"]);
  });

  test("lets go of a token Linear refused, so the next view mints another", async () => {
    const { held, revoked } = setup();
    const refused = await held.linearToken();
    held.refused(refused.token);
    await held.endLinearToken(refused.id);

    expect((await held.linearToken()).id).toBe("id-2");
    expect(revoked).toEqual(["id-1"]);
  });

  test("revokes the token it holds when it is released", async () => {
    const { held, revoked } = setup();
    const token = await held.linearToken();
    await held.endLinearToken(token.id);

    await held.release();

    expect(revoked).toEqual(["id-1"]);
  });
});
