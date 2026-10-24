// PROTOTYPE (BAN-11): an in-memory stand-in for the decks API, holding the
// Seed data's five decks, so each Variant shows real density on a Slug
// Preview. Changes last until the page reloads. Throwaway: the implementation
// replaces it with GET/POST/PATCH/DELETE /api/decks.
import { useSearch } from "@tanstack/react-router";
import { useSyncExternalStore } from "react";

export type Deck = {
  id: string;
  name: string;
  description: string | null;
  createdAt: number;
};

export type DeckSort = "alphabetical" | "newest";

const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();

// The same IDs as SEED_IDS in apps/api/src/seed/seed-ids.ts.
let decks: Deck[] = [
  {
    id: "5eed0000-0000-4000-8000-000000000001",
    name: "Spanish vocabulary",
    description:
      "Everyday words from class and the café down the street.\nSpanish on the front, English on the back.\n\nOne word per card, with an example sentence.",
    createdAt: now - 41 * DAY,
  },
  {
    id: "5eed0000-0000-4000-8000-000000000002",
    name: "Calculus 2",
    description: "Integrals, sequences and series: the second semester.",
    createdAt: now - 30 * DAY,
  },
  {
    id: "5eed0000-0000-4000-8000-000000000003",
    name: "Calculus 10",
    description: null,
    createdAt: now - 2 * DAY,
  },
  {
    id: "5eed0000-0000-4000-8000-000000000004",
    name: "Organic chemistry: reaction mechanisms, named reactions and the reagents behind each of the steps",
    description: null,
    createdAt: now - 12 * DAY,
  },
  {
    id: "5eed0000-0000-4000-8000-000000000005",
    name: "Japanese kanji (JLPT N4)",
    description: "Readings on the back, with one example word each.",
    createdAt: now - 20 * DAY,
  },
];

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useDecks(): readonly Deck[] {
  return useSyncExternalStore(subscribe, () => decks);
}

export function useDeck(id: string): Deck | undefined {
  return useDecks().find((d) => d.id === id);
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export function sortDecks(list: readonly Deck[], sort: DeckSort): Deck[] {
  return list.toSorted((a, b) =>
    sort === "newest" ? b.createdAt - a.createdAt : collator.compare(a.name, b.name),
  );
}

export const NAME_TAKEN = "You already have a deck with this name.";

const clean = (d: string) => (d.trim() === "" ? null : d.trim());

function taken(name: string, except?: string): boolean {
  const n = name.trim().toLocaleLowerCase();
  return decks.some((d) => d.id !== except && d.name.toLocaleLowerCase() === n);
}

export type Result = { ok: true; id: string } | { ok: false; error: string };

function check(name: string, except?: string): string | undefined {
  if (name.trim() === "") return "Give the deck a name.";
  if (name.trim().length > 100) return "Keep the name to 100 characters.";
  if (taken(name, except)) return NAME_TAKEN;
  return undefined;
}

export function createDeck(name: string, description: string): Result {
  const error = check(name);
  if (error !== undefined) return { ok: false, error };
  const deck = {
    id: crypto.randomUUID(),
    name: name.trim(),
    description: clean(description),
    createdAt: Date.now(),
  };
  decks = [...decks, deck];
  emit();
  return { ok: true, id: deck.id };
}

export function updateDeck(id: string, name: string, description: string): Result {
  const error = check(name, id);
  if (error !== undefined) return { ok: false, error };
  decks = decks.map((d) =>
    d.id === id ? { ...d, name: name.trim(), description: clean(description) } : d,
  );
  emit();
  return { ok: true, id };
}

export function deleteDeck(id: string): void {
  decks = decks.filter((d) => d.id !== id);
  emit();
}

// The sort choice, remembered on this device.
const SORT_KEY = "banki.deckSort";
const sortListeners = new Set<() => void>();
export function useDeckSort(): [DeckSort, (s: DeckSort) => void] {
  const stored = useSyncExternalStore(
    (l) => {
      sortListeners.add(l);
      return () => sortListeners.delete(l);
    },
    () => (localStorage.getItem(SORT_KEY) === "newest" ? "newest" : "alphabetical"),
  );
  return [
    stored,
    (s) => {
      localStorage.setItem(SORT_KEY, s);
      sortListeners.forEach((l) => l());
    },
  ];
}

/** The `?state=` a Variant's screen opens in, so every state has a URL. */
export function useProtoState(): string | undefined {
  const search: Record<string, unknown> = useSearch({ strict: false });
  const state = search["state"];
  return typeof state === "string" ? state : undefined;
}

/** A short "created" date: "12 Sep" this year, "12 Sep 2025" before. */
export function createdLabel(at: number): string {
  const d = new Date(at);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}
