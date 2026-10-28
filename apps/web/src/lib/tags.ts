import { CARD_TAGS_MAX, TagListResponse, sortTags, tagNameProblem, tagOf } from "@banki/shared";
import { queryOptions } from "@tanstack/react-query";
import { type ApiClient, api } from "./api";
import type { Card } from "./cards";
import { ApiRequestError } from "./query";

/** The User's Tags on live Cards in live Decks, A–Z, from `GET /api/tags`. */
export const tagsQueryOptions = (client: ApiClient = api) =>
  queryOptions({
    queryKey: ["tags"],
    queryFn: async (): Promise<string[]> => {
      const res = await client.api.tags.$get();
      if (!res.ok) throw new ApiRequestError(res.status);
      return TagListResponse.parse(await res.json());
    },
  });

/**
 * Text as search compares it: lowercased, with the combining diacritics
 * (U+0300–U+036F) dropped after NFD, so `Árbol` reads `arbol` while Japanese
 * が stays が, not か.
 */
export const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .normalize("NFC")
    .toLowerCase();

/** The words of a search, folded; none for a blank one. */
export const wordsOf = (q: string) => fold(q).split(/\s+/).filter(Boolean);

/**
 * Whether a Card shows under a filter: every word somewhere in its Front or
 * Back source, in any order, and every picked Tag among its own.
 */
export function matches(card: Card, words: readonly string[], picked: readonly string[]) {
  if (!picked.every((tag) => card.tags.includes(tag))) return false;
  if (words.length === 0) return true;
  const front = fold(card.front);
  const back = fold(card.back);
  return words.every((word) => front.includes(word) || back.includes(word));
}

/**
 * Text split into runs, the runs that match a word marked, ignoring case and
 * accents as search does, the text NFC-composed (which shows the same), so a
 * decomposed accent marks with its letter. A text whose characters still don't
 * each fold to one character, so positions can't line up, comes back unmarked.
 */
export function highlight(text: string, words: readonly string[]) {
  if (words.length === 0) return [{ text, hit: false }];
  const chars = Array.from(text.normalize("NFC"));
  const folded = chars.map(fold);
  if (folded.some((f) => Array.from(f).length !== 1)) return [{ text, hit: false }];
  const flat = folded.join("");
  // `flat` is one character per character of `text`, but a character may be
  // two UTF-16 units: map unit offsets back to characters.
  const charAt: number[] = [];
  folded.forEach((f, i) => {
    for (let unit = 0; unit < f.length; unit++) charAt.push(i);
  });
  const hits = Array.from(chars, () => false);
  for (const word of words) {
    for (let at = flat.indexOf(word); at !== -1; at = flat.indexOf(word, at + 1)) {
      for (let unit = at; unit < at + word.length; unit++) hits[charAt[unit] ?? 0] = true;
    }
  }
  const runs: { text: string; hit: boolean }[] = [];
  chars.forEach((ch, i) => {
    const hit = hits[i] ?? false;
    const last = runs.at(-1);
    if (last !== undefined && last.hit === hit) last.text += ch;
    else runs.push({ text: ch, hit });
  });
  return runs;
}

/** The Tags these Cards carry, A–Z, each with how many carry it: the deck page's filter. */
export function tagCounts(cards: readonly Card[]): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const card of cards) {
    for (const tag of card.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return sortTags(counts.keys()).map((tag) => ({ tag, count: counts.get(tag) ?? 0 }));
}

/** A search param as text: a number, such as `?q=2024`, reads back as one. */
const asText = (value: unknown) =>
  typeof value === "string" ? value : typeof value === "number" ? String(value) : undefined;

/** The deck page's filter as its URL holds it: `?q=…&tags=verb,irregular`. */
export type DeckSearch = { q?: string; tags?: string };

/**
 * Reads the deck page's search params, keeping only a search and Tags. A value
 * that reads as a number, such as `?q=2024`, comes back as text.
 */
export function deckSearch(search: Record<string, unknown>): DeckSearch {
  const q = asText(search["q"]);
  const tags = asText(search["tags"]);
  return {
    ...(q === undefined || q === "" ? {} : { q }),
    ...(tags === undefined || tags === "" ? {} : { tags }),
  };
}

/** The Tags a deck page's `?tags=` picks, lowercase, once each. */
export const pickedTags = (tags: string | undefined): string[] => [
  ...new Set(
    (tags ?? "")
      .split(",")
      .map((tag) => tag.trim().toLowerCase())
      .filter(Boolean),
  ),
];

/** The search params for a filter: none for an empty search or no Tags. */
export const toDeckSearch = (q: string, picked: readonly string[]): DeckSearch => ({
  ...(q === "" ? {} : { q }),
  ...(picked.length === 0 ? {} : { tags: picked.join(",") }),
});

/**
 * Each Deck's filter as last seen on its page, so Save, Cancel or Delete on a
 * Card's edit page goes back to the same filtered list, as the browser's Back
 * does. It lasts as long as the tab.
 */
const lastFilter = new Map<string, DeckSearch>();
export const rememberDeckSearch = (deckId: string, search: DeckSearch) =>
  lastFilter.set(deckId, search);
export const rememberedDeckSearch = (deckId: string): DeckSearch => lastFilter.get(deckId) ?? {};

/**
 * What's wrong with adding `raw` to a Card's Tags `current`, if anything: a
 * word breaking the Tag rules, or a 21st Tag. A Tag the Card already carries
 * isn't a problem: it is simply not added twice.
 */
export function tagProblem(raw: string, current: readonly string[]): string | undefined {
  const problem = tagNameProblem(raw);
  if (problem !== undefined) return problem;
  const tag = tagOf(raw);
  if (current.length >= CARD_TAGS_MAX && !current.includes(tag)) {
    return `A card carries up to ${CARD_TAGS_MAX} tags.`;
  }
  return undefined;
}

export { tagOf };

/**
 * The suggestions for what's typed in the Tags field: the User's Tags holding
 * it, those starting with it first, leaving out the Card's own, at most six.
 */
export function suggestTags(all: readonly string[], typed: string, own: readonly string[]) {
  const needle = tagOf(typed.trim());
  if (needle === "") return [];
  return all
    .filter((tag) => !own.includes(tag) && tag.includes(needle))
    .toSorted((a, b) => Number(!a.startsWith(needle)) - Number(!b.startsWith(needle)))
    .slice(0, 6);
}

/** Whether two Tag lists differ, as a change to save. */
export const tagsChanged = (a: readonly string[], b: readonly string[]) =>
  a.length !== b.length || a.some((tag, i) => tag !== b[i]);
