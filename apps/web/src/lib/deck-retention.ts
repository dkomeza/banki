import type { QueryClient } from "@tanstack/react-query";
import { createDeckSettingSaver, type DeckSettingState } from "./deck-setting-saver";
import { updateDeck } from "./decks";

// A Deck's own Desired retention, saved as it changes (null to follow
// Settings) by a Deck setting saver (deck-setting-saver.ts).

export type DeckRetentionState = DeckSettingState<number | null>;

/** What the Deck shows: the change not answered yet, if any, or what is stored. */
export const shownRetention = (state: DeckRetentionState, stored: number | null) =>
  state.queue.length === 0 ? stored : (state.queue.at(-1) ?? null);

export const createDeckRetentionSaver = createDeckSettingSaver<number | null>;

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
