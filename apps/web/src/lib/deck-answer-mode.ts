import { ANSWER_MODES, type AnswerMode } from "@banki/shared";
import type { QueryClient } from "@tanstack/react-query";
import { createDeckSettingSaver, type DeckSettingSaver } from "./deck-setting-saver";
import { updateDeck } from "./decks";
import { FOLLOW } from "./retention";

// A Deck's own Answer mode, saved as it changes (null to follow Settings) by a
// Deck setting saver (deck-setting-saver.ts), and how Deck settings and
// Settings show it: the pickers' options and search, and what a change that
// didn't save says. A following Deck shows Settings' mode, `followed`.

const NAMES = {
  "self-rate": "Rate yourself",
  write: "Write and grade",
} as const satisfies Record<AnswerMode, string>;

/** An Answer mode's name, such as "Write and grade". */
export const answerModeName = (mode: AnswerMode): string => NAMES[mode];

type AnswerModeOption = { value: string; label: string; display?: string; detail?: string };

/** Settings' picker's choices: each mode by name. */
export const SETTINGS_ANSWER_MODE_OPTIONS: readonly AnswerModeOption[] = ANSWER_MODES.map(
  (mode) => ({ value: mode, label: NAMES[mode] }),
);

/** A Deck's picker's choices: Follow Settings (showing `followed`, their mode) first, then each mode. */
export const answerModeOptions = (followed: AnswerMode): readonly AnswerModeOption[] => [
  {
    value: FOLLOW,
    label: "Follow Settings",
    display: `Follow Settings (${NAMES[followed]})`,
    detail: NAMES[followed],
  },
  ...SETTINGS_ANSWER_MODE_OPTIONS,
];

/** The `options` a search finds: by name, or Follow Settings for "follow" or "global". */
export function matchAnswerModes<T extends AnswerModeOption>(
  options: readonly T[],
  query: string,
): readonly T[] {
  const wanted = query.trim().toLowerCase().replaceAll(/\s+/g, " ");
  if (wanted === "") return options;
  return options.filter(
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
 * mode, or following Settings), and what the Deck keeps, with `followed`,
 * Settings' mode, while it follows them.
 */
export function answerModeErrorText(
  attempted: AnswerMode | null,
  kept: AnswerMode | null,
  followed: AnswerMode,
): string {
  const tried = attempted === null ? "following Settings" : NAMES[attempted];
  const still =
    kept === null ? `it still follows Settings (${NAMES[followed]})` : `it's still ${NAMES[kept]}`;
  return `The change to ${tried} didn't save, so ${still}.`;
}

/** What a change to Settings' Answer mode that didn't save says: the change, and the mode kept. */
export const settingsAnswerModeErrorText = (attempted: AnswerMode, kept: AnswerMode): string =>
  `The change to ${NAMES[attempted]} didn't save, so it's still ${NAMES[kept]}.`;

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
