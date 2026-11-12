import type { Rating } from "@banki/shared";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "@tanstack/react-router";

// PROTOTYPE (BAN-52): a Card's history, in memory, shaped like the spec's
// `CardHistoryEntry`, newest first. The plain load shows the Card's own
// history as the Seed data will hold it once BAN-52 adds el desayuno's older
// Reviews and its Progress reset; `?state=` swaps in another one.

export type CardHistoryEntry =
  | {
      type: "review";
      id: string;
      cardId: string;
      deckId: string;
      reviewedAt: string;
      rating: Rating;
      kind: "graded" | "self-rated";
      suggestedRating: Rating | null;
      model: string | null;
      durationMs: number;
    }
  | { type: "progress-reset"; id: string; resetAt: string };

export const HISTORY_STATES = ["history", "single", "empty", "history-error"] as const;

const HOUR_MS = 60 * 60 * 1000;
const DESAYUNO = "5eed0000-0000-4000-8000-0000000c0101";
const ROSE = "5eed0000-0000-4000-8000-0000000c0102";
const MANIFEST_CARD = "5eed0000-0000-4000-8000-0000000c0205";
const SPANISH = "5eed0000-0000-4000-8000-000000000001";
const CALCULUS2 = "5eed0000-0000-4000-8000-000000000002";
const MODEL = "anthropic/claude-sonnet-5-5";

type Row =
  | [hoursAgo: number, rating: Rating, durationMs: number, suggested?: Rating]
  | [hoursAgo: number, "reset"];

/** Oldest first, as the seed writes them. */
const ROWS: Record<string, { deckId: string; rows: Row[] }> = {
  [DESAYUNO]: {
    deckId: SPANISH,
    rows: [
      [13 * 24 + 5, "good", 7_400],
      [13 * 24 + 4.8, "good", 3_900],
      [9 * 24 + 2, "easy", 4_100, "easy"],
      [6 * 24 + 7, "hard", 120_000, "hard"],
      [6 * 24 + 6.9, "again", 18_600, "good"],
      [96, "reset"],
      [74, "good", 5_200],
      [73.8, "good", 2_700],
      [2, "again", 9_800, "hard"],
    ],
  },
  [ROSE]: {
    deckId: SPANISH,
    rows: [
      [100, "good", 6_400],
      [99.8, "good", 3_100],
    ],
  },
  [MANIFEST_CARD]: { deckId: CALCULUS2, rows: [[9, "good", 41_000, "good"]] },
};

function entriesOf(cardId: string, now: number): CardHistoryEntry[] {
  const card = ROWS[cardId];
  if (card === undefined) return [];
  return card.rows
    .map((row, n): CardHistoryEntry => {
      const at = new Date(now - row[0] * HOUR_MS).toISOString();
      const id = `proto-${cardId}-${n}`;
      if (row[1] === "reset") return { type: "progress-reset", id, resetAt: at };
      const [, rating, durationMs, suggested] = row;
      return {
        type: "review",
        id,
        cardId,
        deckId: card.deckId,
        reviewedAt: at,
        rating,
        kind: suggested === undefined ? "self-rated" : "graded",
        suggestedRating: suggested ?? null,
        model: suggested === undefined ? null : MODEL,
        durationMs,
      };
    })
    .toReversed();
}

/** Which Card's history a state shows, or the Card's own. */
function shownCard(cardId: string, state: string | undefined) {
  if (state === "history") return DESAYUNO;
  if (state === "single") return MANIFEST_CARD;
  if (state === "empty") return "";
  return cardId;
}

/**
 * The history as the page would fetch it: loading at first, then the
 * entries, or for `?state=history-error` a failure whose Try again
 * (`refetch`) fails again.
 */
export function useCardHistory(cardId: string) {
  const state = useLocation({
    select: (l) => {
      const search: Record<string, unknown> = l.search;
      return typeof search["state"] === "string" ? search["state"] : undefined;
    },
  });
  return useQuery({
    queryKey: ["history-proto", cardId, state ?? ""],
    queryFn: async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
      if (state === "history-error") throw new Error("Couldn't load this card's history.");
      return { entries: entriesOf(shownCard(cardId, state), Date.now()) };
    },
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
}

/** "4 s", "41 s", or "2 min" at the cap. */
export function durationLabel(ms: number) {
  if (ms >= 120_000) return "2 min";
  return `${Math.max(1, Math.round(ms / 1000))} s`;
}
