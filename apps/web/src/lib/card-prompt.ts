import {
  CARD_FILE_JSON_SCHEMA,
  CARD_PROMPT_COUNT_MAX,
  CARD_PROMPT_INSTRUCTIONS_MAX_LENGTH,
  CARD_PROMPT_LANGUAGE_MAX_LENGTH,
  type CardPromptDifficulty,
  type CardPromptOptions,
} from "@banki/shared";
import type { QueryClient } from "@tanstack/react-query";
import { createDeckSettingSaver, type DeckSettingSaver } from "./deck-setting-saver";
import { updateDeck } from "./decks";

// A Deck's options for the Card prompt as its page edits them: the fields as
// typed, what they say when one is out of its limits, and the saver that
// stores them as they change (deck-setting-saver.ts).

/** The options as typed: the number of cards as text, so an out-of-range one shows with its error. */
export type CardPromptDraft = {
  language: string;
  count: string;
  difficulty: CardPromptDifficulty;
  instructions: string;
};

/** Each difficulty's name and what it asks for, in order. */
export const DIFFICULTIES: readonly {
  value: CardPromptDifficulty;
  label: string;
  hint: string;
}[] = [
  { value: "introductory", label: "Introductory", hint: "Definitions and core facts." },
  { value: "intermediate", label: "Intermediate", hint: "How the ideas connect." },
  { value: "advanced", label: "Advanced", hint: "Edge cases and derivations." },
];

/** Stored options as the fields show them. */
export const draftOf = (options: CardPromptOptions): CardPromptDraft => ({
  ...options,
  count: options.count === null ? "" : String(options.count),
});

export type CardPromptErrors = { language?: string; count?: string; instructions?: string };

/**
 * What is wrong with each field of `draft`, and the options it stands for
 * when nothing is: the language trimmed, a blank number null.
 */
export function checkDraft(draft: CardPromptDraft): {
  errors: CardPromptErrors;
  options: CardPromptOptions | undefined;
} {
  const errors: CardPromptErrors = {};
  const language = draft.language.trim();
  if (language.length > CARD_PROMPT_LANGUAGE_MAX_LENGTH) {
    errors.language = `Up to ${CARD_PROMPT_LANGUAGE_MAX_LENGTH} characters: ${language.length - CARD_PROMPT_LANGUAGE_MAX_LENGTH} too many`;
  }
  const countText = draft.count.trim();
  const count = /^\d+$/.test(countText) ? Number(countText) : Number.NaN;
  if (countText !== "" && !(count >= 1 && count <= CARD_PROMPT_COUNT_MAX)) {
    errors.count = `A whole number from 1 to ${CARD_PROMPT_COUNT_MAX.toLocaleString("en-GB")}, or blank`;
  }
  const over = draft.instructions.length - CARD_PROMPT_INSTRUCTIONS_MAX_LENGTH;
  if (over > 0) {
    errors.instructions = `Up to ${CARD_PROMPT_INSTRUCTIONS_MAX_LENGTH.toLocaleString("en-GB")} characters: ${over.toLocaleString("en-GB")} too many`;
  }
  if (Object.keys(errors).length > 0) return { errors, options: undefined };
  return {
    errors,
    options: {
      language,
      count: countText === "" ? null : count,
      difficulty: draft.difficulty,
      instructions: draft.instructions,
    },
  };
}

export const sameOptions = (a: CardPromptOptions, b: CardPromptOptions) =>
  a.language === b.language &&
  a.count === b.count &&
  a.difficulty === b.difficulty &&
  a.instructions === b.instructions;

/** The Card file's JSON Schema as the page shows and copies it. */
export const CARD_FILE_SCHEMA_TEXT = JSON.stringify(CARD_FILE_JSON_SCHEMA, null, 2);

export type DeckCardPromptSaver = DeckSettingSaver<CardPromptOptions>;

/**
 * Each Deck's saver, per query client. It outlives the page: a save keeps
 * running when the User leaves, and a failure is waiting, with Try again,
 * when they come back.
 */
const savers = new WeakMap<QueryClient, Map<string, DeckCardPromptSaver>>();

/**
 * The saver of the Deck `deckId`'s Card prompt options, which keeps the cache
 * in step; `save` stands in for the API, as the saver is made.
 */
export function deckCardPromptSaverFor(
  queryClient: QueryClient,
  deckId: string,
  {
    save = async (cardPrompt) => {
      const outcome = await updateDeck(queryClient, deckId, { cardPrompt });
      if (!outcome.ok) throw new Error(outcome.message);
    },
  }: { save?: (cardPrompt: CardPromptOptions) => Promise<void> } = {},
) {
  let byDeck = savers.get(queryClient);
  if (byDeck === undefined) {
    byDeck = new Map();
    savers.set(queryClient, byDeck);
  }
  let saver = byDeck.get(deckId);
  if (saver === undefined) {
    saver = createDeckSettingSaver<CardPromptOptions>({ save });
    byDeck.set(deckId, saver);
  }
  return saver;
}

/** Forgets every Deck's saver, as signing out does. */
export function dropDeckCardPromptSavers(queryClient: QueryClient) {
  const byDeck = savers.get(queryClient);
  if (byDeck === undefined) return;
  savers.delete(queryClient);
  for (const saver of byDeck.values()) saver.dispose();
}
