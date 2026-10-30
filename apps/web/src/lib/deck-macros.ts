import type { Macro } from "@banki/shared";
import type { QueryClient } from "@tanstack/react-query";
import { createDeckSettingSaver, type DeckSettingSaver } from "./deck-setting-saver";
import { updateDeck } from "./decks";

// A Deck's own Macros, saved as they change, the whole list at a time, by a
// Deck setting saver (deck-setting-saver.ts).

/**
 * Each Deck's saver, per query client. It outlives the page: a save keeps
 * running when the User leaves, and a failure is waiting, with Try again,
 * when they come back.
 */
const savers = new WeakMap<QueryClient, Map<string, DeckSettingSaver<Macro[]>>>();

/** The saver of the Deck `deckId`'s own Macros, which keeps the cache in step. */
export function deckMacrosSaverFor(queryClient: QueryClient, deckId: string) {
  let byDeck = savers.get(queryClient);
  if (byDeck === undefined) {
    byDeck = new Map();
    savers.set(queryClient, byDeck);
  }
  let saver = byDeck.get(deckId);
  if (saver === undefined) {
    saver = createDeckSettingSaver<Macro[]>({
      save: async (macros) => {
        const outcome = await updateDeck(queryClient, deckId, { macros });
        if (!outcome.ok) throw new Error(outcome.message);
      },
    });
    byDeck.set(deckId, saver);
  }
  return saver;
}

/** Forgets every Deck's saver, as signing out does. */
export function dropDeckMacrosSavers(queryClient: QueryClient) {
  const byDeck = savers.get(queryClient);
  if (byDeck === undefined) return;
  savers.delete(queryClient);
  for (const saver of byDeck.values()) saver.dispose();
}
