/**
 * The most live Cards a Deck holds (ADR-0034): its Cards in Recently deleted
 * don't count. The import's own limit, so every Deck's export imports back.
 *
 * In a module of its own, importing nothing, so `imports.ts` can read it
 * while `decks.ts` imports the Card prompt, which imports `imports.ts`.
 */
export const DECK_CARDS_MAX = 1_000;
