// PROTOTYPE (BAN-12): an in-memory stand-in for the cards API, holding the
// Seed data's Cards for the seeded Decks, so each Variant shows real density on
// a Slug Preview. Changes last until the page reloads. Throwaway: the
// implementation replaces it with /api/decks/:deckId/cards and /api/cards/:id.
import { useSearch } from "@tanstack/react-router";
import { useSyncExternalStore } from "react";

export type Card = {
  id: string;
  deckId: string;
  front: string;
  back: string;
  createdAt: number;
  updatedAt: number;
};

const HOUR = 60 * 60 * 1000;
const now = Date.now();
// The same IDs as SEED_IDS.decks in apps/api/src/seed/seed-ids.ts.
const spanish = "5eed0000-0000-4000-8000-000000000001";
const calculus2 = "5eed0000-0000-4000-8000-000000000002";
const chemistry = "5eed0000-0000-4000-8000-000000000004";
const kanji = "5eed0000-0000-4000-8000-000000000005";

// [id, deck, front, back, hours ago]; IDs are fixed, so `SEED_IDS.card` (the
// route manifest's edit-card page) is the second Calculus 2 Card.
const SEED: [string, string, string, string, number][] = [
  ["0c0101", spanish, "el desayuno", "breakfast\nTomo el desayuno a las ocho.", 980],
  ["0c0102", spanish, "la cuenta", "the bill, the check\n¿Nos trae la cuenta, por favor?", 960],
  ["0c0103", spanish, "madrugar", "to get up early", 700],
  ["0c0104", spanish, "el andén", "the (railway) platform", 650],
  ["0c0105", spanish, "quedar", "to meet up; to be left; to suit\n¿Quedamos a las seis?", 400],
  ["0c0106", spanish, "la sobremesa", "the time spent chatting at the table after a meal", 220],
  ["0c0107", spanish, "estar de acuerdo", "to agree\nEstoy de acuerdo contigo.", 90],
  ["0c0108", spanish, "el ayuntamiento", "the town hall", 5],
  ["0c0200", calculus2, "Integration by parts", "$\\int u\\,dv = uv - \\int v\\,du$", 700],
  [
    "0c0201",
    calculus2,
    "Derive the Maclaurin series of $\\ln(1+x)$.\n\nFor which $x$ does it converge?",
    "Start from the geometric series:\n$$\\frac{1}{1+t} = \\sum_{n=0}^{\\infty} (-1)^n t^n, \\quad |t| < 1$$\nIntegrate both sides from $0$ to $x$:\n$$\\ln(1+x) = \\int_0^x \\frac{dt}{1+t} = \\sum_{n=0}^{\\infty} (-1)^n \\frac{x^{n+1}}{n+1}$$\nso\n$$\\ln(1+x) = x - \\frac{x^2}{2} + \\frac{x^3}{3} - \\frac{x^4}{4} + \\cdots$$\nIt converges for $-1 < x \\le 1$: at $x = 1$ by the alternating series test (giving $\\ln 2$), and it diverges at $x = -1$ (the harmonic series).",
    500,
  ],
  [
    "0c0202",
    calculus2,
    "Ratio test",
    "If $\\lim_{n\\to\\infty} \\left|\\frac{a_{n+1}}{a_n}\\right| = L < 1$, then $\\sum a_n$ converges absolutely; $L > 1$ diverges; $L = 1$ says nothing.",
    300,
  ],
  [
    "0c0203",
    calculus2,
    "$\\int \\sec x \\, dx$",
    "$\\ln\\lvert \\sec x + \\tan x \\rvert + C$",
    120,
  ],
  [
    "0c0204",
    calculus2,
    "When does $\\sum \\frac{1}{n^p}$ converge?",
    "For $p > 1$ (the $p$-series test).",
    30,
  ],
  ["0c0300", kanji, "駅", "えき (eki): station\n駅前 (えきまえ): in front of the station", 600],
  ["0c0301", kanji, "質", "シツ, シチ: quality, matter\n質問 (しつもん): question", 400],
  ["0c0302", kanji, "借", "か(りる), シャク: borrow\n借りる (かりる): to borrow", 200],
  [
    "0c0303",
    kanji,
    "construct a sentence with 急に",
    "急に雨が降り出した。\nIt suddenly started to rain.",
    60,
  ],
  [
    "0c0400",
    chemistry,
    "SN1 vs SN2: which is favoured by a tertiary substrate?",
    "SN1: the tertiary carbocation is stabilised, and the backside attack of SN2 is blocked.",
    800,
  ],
  [
    "0c0401",
    chemistry,
    "Walk through the mechanism of the aldol condensation under basic conditions, naming each intermediate.",
    "1. Hydroxide removes an α-hydrogen from the aldehyde, giving a resonance-stabilised enolate.\n2. The enolate's α-carbon attacks the carbonyl carbon of a second aldehyde molecule, giving an alkoxide.\n3. The alkoxide takes a proton from water, giving the β-hydroxy aldehyde (the aldol) and regenerating hydroxide.\n4. On heating, hydroxide removes another α-hydrogen, giving an enolate again.\n5. The enolate pushes out hydroxide from the β-carbon (E1cB), giving the α,β-unsaturated aldehyde.\n\nThe condensation step is driven by conjugation: the C=C ends up conjugated with the C=O, which is why heating pushes the equilibrium to the enal. With two different carbonyl partners you get a crossed aldol, and a mixture unless one partner has no α-hydrogens (benzaldehyde, formaldehyde) or one is preformed as its enolate with LDA at −78 °C.",
    350,
  ],
  [
    "0c0402",
    chemistry,
    "Grignard reagent + ketone gives…",
    "a tertiary alcohol (after an acidic workup)",
    100,
  ],
];

let cards: Card[] = SEED.map(([id, deckId, front, back, hours]) => ({
  id: `5eed0000-0000-4000-8000-000000${id}`,
  deckId,
  front,
  back,
  createdAt: now - hours * HOUR,
  updatedAt: now - hours * HOUR,
}));

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** A Deck's live Cards, newest first. */
export function useCards(deckId: string): readonly Card[] {
  const all = useSyncExternalStore(subscribe, () => cards);
  return all.filter((c) => c.deckId === deckId).toSorted((a, b) => b.createdAt - a.createdAt);
}

export function useCard(id: string): Card | undefined {
  return useSyncExternalStore(subscribe, () => cards).find((c) => c.id === id);
}

export const MAX_SIDE = 20_000;

export type SideErrors = { front?: string; back?: string };

const problem = (side: string, name: string) =>
  side.trim() === ""
    ? `Write the ${name}.`
    : side.length > MAX_SIDE
      ? `Keep the ${name} to ${MAX_SIDE.toLocaleString("en-GB")} characters.`
      : undefined;

/** Each side's problem, as the API's 400 `invalid_request` would answer it. */
export function sideErrors(front: string, back: string): SideErrors {
  const errors: SideErrors = {};
  const f = problem(front, "Front");
  const b = problem(back, "Back");
  if (f !== undefined) errors.front = f;
  if (b !== undefined) errors.back = b;
  return errors;
}

/** Creates a Card exactly as typed, or answers what's wrong with it. */
export function createCard(deckId: string, front: string, back: string): SideErrors | Card {
  const errors = sideErrors(front, back);
  if (errors.front !== undefined || errors.back !== undefined) return errors;
  const at = Date.now();
  const card = { id: crypto.randomUUID(), deckId, front, back, createdAt: at, updatedAt: at };
  cards = [...cards, card];
  emit();
  return card;
}

export function updateCard(id: string, front: string, back: string): SideErrors | undefined {
  const errors = sideErrors(front, back);
  if (errors.front !== undefined || errors.back !== undefined) return errors;
  cards = cards.map((c) => (c.id === id ? { ...c, front, back, updatedAt: Date.now() } : c));
  emit();
  return undefined;
}

let deleted: Card[] = [];

export function deleteCard(id: string): Card | undefined {
  const card = cards.find((c) => c.id === id);
  if (card === undefined) return undefined;
  cards = cards.filter((c) => c.id !== id);
  deleted = [...deleted, card];
  emit();
  return card;
}

/** Undo: puts a deleted Card back, in its place by `createdAt`. */
export function restoreCard(id: string): boolean {
  const card = deleted.find((c) => c.id === id);
  if (card === undefined) return false;
  deleted = deleted.filter((c) => c.id !== id);
  cards = [...cards, card];
  emit();
  return true;
}

/** "12 cards", "1 card", "No cards". */
export function cardCount(n: number): string {
  return n === 0 ? "No cards" : n === 1 ? "1 card" : `${n} cards`;
}

/** The `?state=` a Variant's screen opens in, so every state has a URL. */
export function useProtoState(): string | undefined {
  const search: Record<string, unknown> = useSearch({ strict: false });
  const state = search["state"];
  return typeof state === "string" ? state : undefined;
}

/** Sample text a state shows as typed but not saved. */
export const UNSAVED = {
  front: "el mercado",
  back: "the market\nCompramos fruta en el mercado.",
};
