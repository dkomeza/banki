import type { QueryClient } from "@tanstack/react-query";
import { updateDeck } from "./decks";

// Saving a Deck's own Desired retention as it changes (null to follow
// Settings): one PATCH at a time, in the order the changes were made, so the
// Deck ends up with the last one. Each change shows at once; one that fails
// is reported with its value, for Try again, until it is tried again or a
// newer change replaces it.

export type DeckRetentionState = {
  /** Changes not answered yet, in order; the first is being sent. */
  queue: readonly (number | null)[];
  /** Whether the last change saved a moment ago. */
  saved: boolean;
  /** The last change that didn't save, until it is tried again or replaced. */
  failed: { attempted: number | null } | undefined;
};

const SAVED_MS = 2000;

/** What the Deck shows: the change not answered yet, if any, or what is stored. */
export const shownRetention = (state: DeckRetentionState, stored: number | null) =>
  state.queue.length === 0 ? stored : (state.queue.at(-1) ?? null);

export function createDeckRetentionSaver({
  save,
  afterSaved = (clear) => {
    const timer = globalThis.setTimeout(clear, SAVED_MS);
    return () => globalThis.clearTimeout(timer);
  },
}: {
  /** Stores the value, throwing when that fails. */
  save: (value: number | null) => Promise<void>;
  /** Schedules clearing "Saved"; returns a cancel. */
  afterSaved?: (clear: () => void) => () => void;
}) {
  let state: DeckRetentionState = { queue: [], saved: false, failed: undefined };
  const listeners = new Set<() => void>();
  let cancelSaved: (() => void) | undefined;
  let disposed = false;

  const update = (next: Partial<DeckRetentionState>) => {
    state = { ...state, ...next };
    for (const listener of listeners) listener();
  };

  const sendNext = async () => {
    const value = state.queue[0];
    if (value === undefined) return;
    let ok = true;
    try {
      await save(value);
    } catch {
      ok = false;
    }
    if (disposed) return;
    const rest = state.queue.slice(1);
    if (!ok) {
      // A newer change is already queued: this one is moot.
      update({ queue: rest, failed: rest.length > 0 ? state.failed : { attempted: value } });
    } else {
      update({ queue: rest, failed: rest.length > 0 ? state.failed : undefined });
      if (rest.length === 0) {
        cancelSaved?.();
        cancelSaved = afterSaved(() => update({ saved: false }));
        update({ saved: true });
      }
    }
    void sendNext();
  };

  const change = (value: number | null) => {
    const idle = state.queue.length === 0;
    update({ queue: [...state.queue, value], saved: false, failed: undefined });
    if (idle) void sendNext();
  };

  return {
    getState: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    change,
    /** Sends the failed change again. */
    retry() {
      if (state.failed !== undefined) change(state.failed.attempted);
    },
    dispose() {
      disposed = true;
      cancelSaved?.();
      listeners.clear();
    },
  };
}

export type DeckRetentionSaver = ReturnType<typeof createDeckRetentionSaver>;

/**
 * Each Deck's saver, per query client. It outlives the page: a save keeps
 * running when the User leaves, and a failure is waiting, with Try again,
 * when they come back.
 */
const savers = new WeakMap<QueryClient, Map<string, DeckRetentionSaver>>();

/** The saver of the Deck `deckId`'s Desired retention, which keeps the cache in step. */
export function deckRetentionSaverFor(queryClient: QueryClient, deckId: string) {
  let byDeck = savers.get(queryClient);
  if (byDeck === undefined) {
    byDeck = new Map();
    savers.set(queryClient, byDeck);
  }
  let saver = byDeck.get(deckId);
  if (saver === undefined) {
    saver = createDeckRetentionSaver({
      save: async (desiredRetention) => {
        const outcome = await updateDeck(queryClient, deckId, { desiredRetention });
        if (!outcome.ok) throw new Error(outcome.message);
      },
    });
    byDeck.set(deckId, saver);
  }
  return saver;
}

/** Forgets every Deck's saver, as signing out does. */
export function dropDeckRetentionSavers(queryClient: QueryClient) {
  const byDeck = savers.get(queryClient);
  if (byDeck === undefined) return;
  savers.delete(queryClient);
  for (const saver of byDeck.values()) saver.dispose();
}
