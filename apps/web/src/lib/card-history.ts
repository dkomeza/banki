import { type CardHistoryEntry, REVIEW_CAP_MS, type Rating } from "@banki/shared";
import { dayLabel } from "./card-days";

// How the edit page's History reads a Card's history (CONTEXT.md: Review):
// its entries, newest first in the Write order, in runs of one day each, each
// with its time in the margin, a Progress reset among them in its place.

/** When an entry happened: a Review's moment, or a Progress reset's. */
export const entryAt = (entry: CardHistoryEntry) =>
  entry.type === "review" ? entry.reviewedAt : entry.resetAt;

/** An entry, and whether a Progress reset came after it. */
export type HistoryItem = { entry: CardHistoryEntry; beforeReset: boolean };

/**
 * Entries already newest first, in runs of one day each (one per
 * `dayLabel`), keeping their order, each marked when a Progress reset came
 * after it. A run is a day's entries next to each other: a clock that stepped
 * back can make a day come twice.
 */
export function historyByDay(
  entries: readonly CardHistoryEntry[],
  now = new Date(),
): { day: string; items: HistoryItem[] }[] {
  const days: { day: string; items: HistoryItem[] }[] = [];
  let beforeReset = false;
  for (const entry of entries) {
    const day = dayLabel(entryAt(entry), now);
    const item = { entry, beforeReset };
    const last = days.at(-1);
    if (last?.day === day) last.items.push(item);
    else days.push({ day, items: [item] });
    if (entry.type === "progress-reset") beforeReset = true;
  }
  return days;
}

/** "4 s": the time a Review spent, in whole seconds, or "2 min" at the cap. */
export const durationLabel = (ms: number) =>
  ms >= REVIEW_CAP_MS ? "2 min" : `${Math.round(ms / 1000)} s`;

/**
 * The Grader's suggested Rating of a graded Review whose Rating differs from
 * it; undefined for one that kept it, or a self-rated one.
 */
export function changedSuggestion(entry: CardHistoryEntry): Rating | undefined {
  if (entry.type !== "review" || entry.kind !== "graded") return undefined;
  const { suggestedRating, rating } = entry;
  return suggestedRating !== null && suggestedRating !== rating ? suggestedRating : undefined;
}

/** How tall a Review's bar in the strip is: a quarter for each step from Again to Easy. */
export const RATING_LEVEL: Record<Rating, number> = { again: 1, hard: 2, good: 3, easy: 4 };
