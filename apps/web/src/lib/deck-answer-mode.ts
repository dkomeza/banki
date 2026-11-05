import { ANSWER_MODES, type AnswerMode, DEFAULT_ANSWER_MODE } from "@banki/shared";
import type { QueryClient } from "@tanstack/react-query";
import { createDeckSettingSaver, type DeckSettingSaver } from "./deck-setting-saver";
import { updateDeck } from "./decks";
import { FOLLOW } from "./retention";

// A Deck's own Answer mode, saved as it changes (null to follow Settings) by a
// Deck setting saver (deck-setting-saver.ts), and how Deck settings show it:
// the picker's options and search, and what a change that didn't save says.
// Until Settings hold an Answer mode (BAN-44), a Deck follows the default.

const NAMES = {
  "self-rate": "Rate yourself",
  write: "Write and grade",
} as const satisfies Record<AnswerMode, string>;

/** An Answer mode's name, such as "Write and grade". */
export const answerModeName = (mode: AnswerMode): string => NAMES[mode];

/** The Answer mode a following Deck has: Settings' (the default, for now). */
export const FOLLOWED_ANSWER_MODE = DEFAULT_ANSWER_MODE;

/** The picker's choices: Follow Settings (showing their mode) first, then each mode. */
export const ANSWER_MODE_OPTIONS = [
  {
    value: FOLLOW,
    label: "Follow Settings",
    display: `Follow Settings (${NAMES[FOLLOWED_ANSWER_MODE]})`,
    detail: NAMES[FOLLOWED_ANSWER_MODE],
  },
  ...ANSWER_MODES.map((mode) => ({ value: mode, label: NAMES[mode] })),
] as const;

/** The choices a search finds: by name, or Follow Settings for "follow" or "global". */
export function matchAnswerModes(query: string): readonly (typeof ANSWER_MODE_OPTIONS)[number][] {
  const wanted = query.trim().toLowerCase().replaceAll(/\s+/g, " ");
  if (wanted === "") return ANSWER_MODE_OPTIONS;
  return ANSWER_MODE_OPTIONS.filter(
    (option) =>
      option.label.toLowerCase().includes(wanted) ||
      (option.value === FOLLOW && "global".includes(wanted)),
  );
}

/** The picker's value as a Deck's own Answer mode: null for Follow Settings, undefined for none. */
export function pickedAnswerMode(value: string): AnswerMode | null | undefined {
  if (value === FOLLOW) return null;
  return ANSWER_MODES.find((mode) => mode === value);
}

/**
 * What a change to a Deck's Answer mode that didn't save says: the change (a
 * mode, or following Settings), and what the Deck keeps.
 */
export function answerModeErrorText(attempted: AnswerMode | null, kept: AnswerMode | null): string {
  const tried = attempted === null ? "following Settings" : NAMES[attempted];
  const still =
    kept === null
      ? `it still follows Settings (${NAMES[FOLLOWED_ANSWER_MODE]})`
      : `it's still ${NAMES[kept]}`;
  return `The change to ${tried} didn't save, so ${still}.`;
}

export type DeckAnswerModeSaver = DeckSettingSaver<AnswerMode | null>;

/**
 * Each Deck's saver, per query client. It outlives the page: a save keeps
 * running when the User leaves, and a failure is waiting, with Try again,
 * when they come back.
 */
const savers = new WeakMap<QueryClient, Map<string, DeckAnswerModeSaver>>();

/**
 * The saver of the Deck `deckId`'s Answer mode, which keeps the cache in
 * step; `save` stands in for the API, as the saver is made.
 */
export function deckAnswerModeSaverFor(
  queryClient: QueryClient,
  deckId: string,
  {
    save = async (answerMode) => {
      const outcome = await updateDeck(queryClient, deckId, { answerMode });
      if (!outcome.ok) throw new Error(outcome.message);
    },
  }: { save?: (answerMode: AnswerMode | null) => Promise<void> } = {},
) {
  let byDeck = savers.get(queryClient);
  if (byDeck === undefined) {
    byDeck = new Map();
    savers.set(queryClient, byDeck);
  }
  let saver = byDeck.get(deckId);
  if (saver === undefined) {
    saver = createDeckSettingSaver<AnswerMode | null>({ save });
    byDeck.set(deckId, saver);
  }
  return saver;
}

/** Forgets every Deck's saver, as signing out does. */
export function dropDeckAnswerModeSavers(queryClient: QueryClient) {
  const byDeck = savers.get(queryClient);
  if (byDeck === undefined) return;
  savers.delete(queryClient);
  for (const saver of byDeck.values()) saver.dispose();
}
