import type { Broker } from "../cli/broker-client";
import { errorText } from "../lib/config";

// The Dashboard's Linear token (ADR-0015): one held for 15 minutes and shared
// by every view computed meanwhile, rather than one minted and revoked for
// each view, so an open Dashboard mints 4 an hour, not 120. Linear seems to
// revoke a token under its holder when two mints come at the same moment,
// and a Stage's supervisor mints one as its Stage ends: every mint the
// Dashboard spares is one less chance of that. A token Linear refuses is let
// go at once. A token is revoked once it is let go and no view uses it any
// more; one left when the Dashboard exits, the Broker revokes 4 hours after
// issue. Pure but for the Broker and the clock it is given, so it is
// unit-tested.

/** How long the Dashboard holds a Linear token before minting the next. */
export const HOLD_MS = 15 * 60_000;

type Held = { id: string; token: string; mintedAt: number; users: number; letGo: boolean };

export type HeldToken = Pick<Broker, "linearToken" | "endLinearToken"> & {
  /** Lets go of `token`, which Linear refused, so the next view mints another. */
  refused: (token: string) => void;
  /** Lets go of the token held, revoking it once no view uses it. */
  release: () => Promise<void>;
};

export function heldToken(options: {
  broker: Pick<Broker, "linearToken" | "endLinearToken">;
  now: () => number;
  log: (line: string) => void;
  holdMs?: number;
}): HeldToken {
  const holdMs = options.holdMs ?? HOLD_MS;
  const tokens = new Map<string, Held>();
  let current: Held | undefined;
  let minting: Promise<Held> | undefined;

  async function revoke(held: Held): Promise<void> {
    tokens.delete(held.id);
    await options.broker.endLinearToken(held.id).catch((error: unknown) => {
      options.log(
        `Couldn't revoke the Dashboard's Linear token (the Broker revokes it 4 hours after issue): ${errorText(error)}`,
      );
    });
  }

  async function letGo(held: Held): Promise<void> {
    held.letGo = true;
    if (current === held) current = undefined;
    if (held.users === 0) await revoke(held);
  }

  /** A new token, shared by the views that ask while it is being minted. */
  function mint(): Promise<Held> {
    minting ??= options.broker
      .linearToken()
      .then((minted) => {
        const held = { ...minted, mintedAt: options.now(), users: 0, letGo: false };
        tokens.set(held.id, held);
        current = held;
        return held;
      })
      .finally(() => {
        minting = undefined;
      });
    return minting;
  }

  return {
    async linearToken() {
      if (current !== undefined && options.now() - current.mintedAt >= holdMs) {
        void letGo(current);
      }
      const held = current ?? (await mint());
      held.users += 1;
      return { id: held.id, token: held.token };
    },

    async endLinearToken(id) {
      const held = tokens.get(id);
      if (held === undefined) return;
      held.users = Math.max(0, held.users - 1);
      if (held.letGo && held.users === 0) await revoke(held);
    },

    refused(token) {
      if (current?.token === token) void letGo(current);
    },

    async release() {
      if (current !== undefined) await letGo(current);
    },
  };
}
