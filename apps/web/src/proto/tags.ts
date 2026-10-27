import { useNavigate, useSearch } from "@tanstack/react-router";
import { type KeyboardEvent, useState, useSyncExternalStore } from "react";
import { SEED_IDS } from "../../../api/src/seed/seed-ids";
import type { Card } from "@/lib/cards";

// Prototype only (BAN-14): the Tags live here, in the browser, keyed by Card
// ID, so the Variants can show them without the API's `card_tag` table. A
// reload brings back the Seed data's Tags. Search and the tag filter match
// the way the spec says the real ones will.

const { spanish, calculus2, kanji, chemistry } = SEED_IDS.cards;

/** The Seed data's Tags, as the implementation will seed them. */
const SEED_TAGS: Record<string, string[]> = {
  [spanish[0]]: ["a1", "food", "noun"],
  [spanish[1]]: ["a1", "food", "noun", "restaurant"],
  [spanish[2]]: ["b1", "daily-routine", "verb"],
  [spanish[3]]: ["b1", "noun", "travel"],
  [spanish[4]]: [
    "b1",
    "exam",
    "false-friend",
    "phrasal",
    "polysemous",
    "reflexive",
    "social",
    "verb",
  ],
  [spanish[5]]: ["culture", "food", "noun", "untranslatable"],
  [spanish[6]]: ["a2", "irregular", "phrase", "verb"],
  [spanish[7]]: ["city", "noun"],
  [calculus2[0]]: ["exam", "integrals", "technique"],
  [calculus2[1]]: ["derivation", "exam", "series"],
  [calculus2[2]]: ["convergence", "series", "tests"],
  [calculus2[3]]: ["integrals", "trig"],
  [calculus2[4]]: ["convergence", "series"],
  [kanji[0]]: ["n4", "place"],
  [kanji[1]]: ["n4", "on-yomi"],
  [kanji[2]]: ["n4", "verb", "動詞"],
  [kanji[3]]: ["grammar", "n4"],
  [chemistry[0]]: ["mechanism", "substitution"],
  [chemistry[1]]: ["carbonyl", "mechanism", "named-reaction"],
  [chemistry[2]]: ["carbonyl", "grignard", "named-reaction"],
};

let tags = new Map(Object.entries(SEED_TAGS));
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const NONE: readonly string[] = [];

/** A Card's Tags, A–Z. */
export const tagsOf = (cardId: string): readonly string[] => tags.get(cardId) ?? NONE;

/** Replaces a Card's Tags, as a save would. */
export function setCardTags(cardId: string, next: readonly string[]) {
  tags = new Map(tags).set(cardId, [...new Set(next.map((t) => t.toLowerCase()))].toSorted());
  for (const listener of listeners) listener();
}

/** A Card's Tags, following changes. */
export const useCardTags = (cardId: string) =>
  useSyncExternalStore(subscribe, () => tagsOf(cardId));

/** Every Tag the User's Cards carry, A–Z, as `GET /api/tags` will answer. */
export function allTags(): string[] {
  return [...new Set([...tags.values()].flat())].toSorted();
}

/** The Tags these Cards carry, A–Z, each with how many carry it. */
export function deckTags(cards: readonly Card[]): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const card of cards) {
    for (const tag of tagsOf(card.id)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts]
    .map(([tag, count]) => ({ tag, count }))
    .toSorted((a, b) => a.tag.localeCompare(b.tag));
}

/** Lowercased, with Latin accents stripped: `Árbol` is `arbol`, が stays が. */
export const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .normalize("NFC")
    .toLowerCase();

/** The words of a search, folded. */
export const wordsOf = (q: string) => fold(q).split(/\s+/).filter(Boolean);

/** Whether a Card matches every word and carries every picked Tag. */
export function matches(card: Card, words: readonly string[], picked: readonly string[]) {
  const text = fold(`${card.front}\n${card.back}`);
  const own = tagsOf(card.id);
  return words.every((w) => text.includes(w)) && picked.every((t) => own.includes(t));
}

/**
 * Splits text into runs, marking the runs that match a word, ignoring case and
 * accents, so a Variant can highlight them.
 */
export function highlight(
  text: string,
  words: readonly string[],
): { text: string; hit: boolean }[] {
  if (words.length === 0) return [{ text, hit: false }];
  // Folding keeps one folded character per original one for Latin text, so
  // positions line up; a text where they don't isn't highlighted.
  const folded = [...text].map((ch) => fold(ch));
  if (folded.some((f) => [...f].length !== 1)) return [{ text, hit: false }];
  const flat = folded.join("");
  const hits = new Array<boolean>(folded.length).fill(false);
  for (const word of words) {
    let at = flat.indexOf(word);
    while (at !== -1) {
      for (let i = at; i < at + word.length; i++) hits[i] = true;
      at = flat.indexOf(word, at + 1);
    }
  }
  const chars = [...text];
  const runs: { text: string; hit: boolean }[] = [];
  chars.forEach((ch, i) => {
    const last = runs.at(-1);
    if (last !== undefined && last.hit === hits[i]) last.text += ch;
    else runs.push({ text: ch, hit: hits[i] ?? false });
  });
  return runs;
}

const TAG = /^[\p{L}\p{N}_-]+$/u;
export const TAG_MAX = 50;
export const TAGS_MAX = 20;

/** What's wrong with adding `raw` to `current`, if anything. */
export function tagProblem(raw: string, current: readonly string[]): string | undefined {
  if (!TAG.test(raw)) return "A Tag is one word: letters, digits, - and _.";
  if ([...raw].length > TAG_MAX) return `Keep a Tag to ${TAG_MAX} characters.`;
  if (current.length >= TAGS_MAX && !current.includes(raw.toLowerCase())) {
    return `A card carries up to ${TAGS_MAX} Tags.`;
  }
  return undefined;
}

/** The `?state=` a Variant's screen opens in, so every state has a URL. */
export function useProtoState(): string | undefined {
  const search: Record<string, unknown> = useSearch({ strict: false });
  const state = search["state"];
  return typeof state === "string" ? state : undefined;
}

/** The deck page's filter, kept in the URL as `?q=…&tags=a,b`. */
export function useDeckFilter() {
  const search: Record<string, unknown> = useSearch({ strict: false });
  const navigate = useNavigate();
  // A state's preset applies while the URL names no filter of its own.
  const preset =
    search["q"] === undefined && search["tags"] === undefined && typeof search["state"] === "string"
      ? DECK_STATES[search["state"]]
      : undefined;
  const q = preset?.q ?? (search["q"] === undefined ? "" : String(search["q"]));
  const raw =
    preset?.tags.join(",") ?? (search["tags"] === undefined ? "" : String(search["tags"]));
  const picked = raw.split(",").filter(Boolean);
  const set = (next: { q?: string; tags?: readonly string[] }) => {
    const nq = next.q ?? q;
    const nt = next.tags ?? picked;
    void navigate({
      to: ".",
      replace: true,
      search: (prev: Record<string, unknown>) => {
        const out: Record<string, unknown> = { ...prev };
        delete out["state"];
        if (nq === "") delete out["q"];
        else out["q"] = nq;
        if (nt.length === 0) delete out["tags"];
        else out["tags"] = nt.join(",");
        return out;
      },
    });
  };
  return {
    q,
    picked,
    setQ: (value: string) => set({ q: value }),
    toggle: (tag: string) =>
      set({ tags: picked.includes(tag) ? picked.filter((t) => t !== tag) : [...picked, tag] }),
    setTags: (value: readonly string[]) => set({ tags: value }),
    clear: () => set({ q: "", tags: [] }),
    setBoth: (value: string, next: readonly string[]) => set({ q: value, tags: next }),
    active: q.trim() !== "" || picked.length > 0,
  };
}

/** What each state of the deck page opens with. */
export const DECK_STATES: Record<string, { q: string; tags: string[] }> = {
  search: { q: "the", tags: [] },
  tags: { q: "", tags: ["food", "noun"] },
  "no-match": { q: "gato", tags: [] },
};

/**
 * The Tags field's state: the Tags as chips, the word being typed, its error,
 * and the suggestions for it. Space, comma or Enter ends a Tag; Backspace in
 * an empty field removes the last one; arrows and Enter pick a suggestion.
 */
export function useTagInput(
  initial: readonly string[],
  init?: { draft?: string; error?: boolean },
) {
  const [tags, setTags] = useState<readonly string[]>(initial);
  const [draft, setDraft] = useState(init?.draft ?? "");
  const [error, setError] = useState<string | undefined>(
    init?.error && init.draft !== undefined ? tagProblem(init.draft, initial) : undefined,
  );
  const [open, setOpen] = useState(init?.draft !== undefined && !init.error);
  const [active, setActive] = useState(0);

  const needle = fold(draft.trim());
  const suggestions =
    needle === ""
      ? []
      : allTags()
          .filter((t) => !tags.includes(t) && t.includes(needle))
          .toSorted((a, b) => Number(!a.startsWith(needle)) - Number(!b.startsWith(needle)))
          .slice(0, 6);

  // Answers the Tags with the word added, or false when it was refused.
  const add = (raw: string, current = tags): readonly string[] | false => {
    const word = raw.trim();
    if (word === "") return current;
    const problem = tagProblem(word, current);
    if (problem !== undefined) {
      setError(problem);
      return false;
    }
    const lower = word.toLowerCase();
    const next = current.includes(lower) ? current : [...current, lower].toSorted();
    setTags(next);
    setDraft("");
    setError(undefined);
    setActive(0);
    return next;
  };

  return {
    tags,
    draft,
    error,
    open: open && suggestions.length > 0,
    suggestions,
    active,
    setActive,
    setTags,
    add,
    remove: (tag: string) => setTags(tags.filter((t) => t !== tag)),
    pick: (tag: string) => {
      add(tag);
      setOpen(false);
    },
    change: (value: string) => {
      // A pasted or typed separator ends the Tag before it.
      const parts = value.split(/[\s,]+/);
      if (parts.length > 1) {
        const rest = parts.pop() ?? "";
        let current: readonly string[] = tags;
        for (const part of parts) {
          const next = add(part, current);
          if (next === false) return setDraft(value.replace(/[\s,]+$/, ""));
          current = next;
        }
        setDraft(rest);
      } else setDraft(value);
      setError(undefined);
      setOpen(true);
      setActive(0);
    },
    blur: () => setOpen(false),
    keyDown: (event: KeyboardEvent<HTMLInputElement>) => {
      const list = open && suggestions.length > 0;
      if (event.key === "ArrowDown" && list) {
        event.preventDefault();
        setActive((i) => Math.min(i + 1, suggestions.length - 1));
      } else if (event.key === "ArrowUp" && list) {
        event.preventDefault();
        setActive((i) => Math.max(i - 1, 0));
      } else if (event.key === "Enter" && list && suggestions[active] !== undefined) {
        event.preventDefault();
        add(suggestions[active]);
        setOpen(false);
      } else if (event.key === "Enter" && draft.trim() !== "") {
        event.preventDefault();
        add(draft);
      } else if (event.key === "Escape" && list) {
        event.preventDefault();
        setOpen(false);
      } else if (event.key === "Backspace" && draft === "" && tags.length > 0) {
        event.preventDefault();
        setTags(tags.slice(0, -1));
      }
    },
  };
}

export type TagInput = ReturnType<typeof useTagInput>;

/** What each Tags-field state opens with, on the new and edit card pages. */
export const FIELD_STATES = {
  /** New card: a Tag kept from the last Card, and "n" typed. */
  new: { suggest: { tags: ["verb"], draft: "n" } },
  /** Edit card (the Maclaurin series Card): "con" typed, or a Tag refused. */
  edit: { suggest: { draft: "con" }, "tag-error": { draft: "taylor's", error: true } },
} as const;

/** The Tags kept after a Save in the new card's `kept` state, and the Card written. */
export const KEPT = {
  tags: ["food", "noun"],
  card: { front: "el mercado", back: "the market\nCompramos fruta en el mercado." },
};
