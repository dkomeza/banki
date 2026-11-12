import { REVIEW_CAP_MS, type StudyDaySettings, addStudyDays, studyDayOf } from "@banki/shared";

// How long a Session will take, from the User's own Reviews: what one Card
// has taken them in a Study day, per kind, over the last 30 Study days.

/** What the estimate needs to know of one of the User's Reviews. */
export type TimedReview = {
  cardId: string;
  reviewedAt: Date;
  durationMs: number;
  /** Whether the Card was New when it was rated: its first Review. */
  wasNew: boolean;
};

/** How many Study days of Reviews the averages look back over, today included. */
export const ESTIMATE_WINDOW_DAYS = 30;
/** How many Card-days of a kind its average needs before it replaces the default. */
export const MIN_CARD_DAYS = 20;
/** What one review Card takes in a Study day, until there are enough Card-days. */
export const DEFAULT_REVIEW_MS = 10_000;
/** What one New card takes on the Study day it is first rated, until there are enough Card-days. */
export const DEFAULT_NEW_MS = 60_000;

/** One Card's Reviews on one Study day (`YYYY-MM-DD`), in the order they were given. */
export type CardDay<T> = { cardId: string; day: string; reviews: T[] };

/** `reviews` grouped into Card-days under `studyDay`, each keeping their order. */
export function cardDaysOf<T extends { cardId: string; reviewedAt: Date }>(
  reviews: readonly T[],
  studyDay: StudyDaySettings,
): CardDay<T>[] {
  const cardDays = new Map<string, CardDay<T>>();
  for (const review of reviews) {
    const day = studyDayOf(review.reviewedAt, studyDay);
    const key = `${review.cardId}\u0000${day}`;
    const cardDay = cardDays.get(key);
    if (cardDay === undefined) cardDays.set(key, { cardId: review.cardId, day, reviews: [review] });
    else cardDay.reviews.push(review);
  }
  return [...cardDays.values()];
}

/** A Card-day's time: its Reviews', each counted for at most 2 minutes. */
export const cardDayMs = (reviews: readonly { durationMs: number }[]): number =>
  reviews.reduce((sum, r) => sum + Math.min(Math.max(0, r.durationMs), REVIEW_CAP_MS), 0);

/** The average time one Card takes in a Study day, per kind. */
export type CardDayAverages = { reviewMs: number; newMs: number };

/**
 * The average time one Card takes in a Study day, per kind, from `reviews` in
 * the last 30 Study days to `now` (today included). A Card-day is one Card's
 * Reviews on one Study day, each counted for at most 2 minutes: a New card's
 * on the day of its first Review (its learning steps included), a review
 * Card's on a day it wasn't New. A kind with fewer than 20 Card-days has its
 * default: 10 s a review Card, 60 s a New card.
 */
export function cardDayAverages(
  reviews: readonly TimedReview[],
  { now, studyDay }: { now: Date; studyDay: StudyDaySettings },
): CardDayAverages {
  const firstDay = addStudyDays(studyDayOf(now, studyDay), -(ESTIMATE_WINDOW_DAYS - 1));
  const all = cardDaysOf(
    reviews.filter((review) => review.reviewedAt.getTime() <= now.getTime()),
    studyDay,
  )
    .filter(({ day }) => day >= firstDay)
    .map(({ reviews: one }) => ({ ms: cardDayMs(one), isNew: one.some((r) => r.wasNew) }));
  return {
    reviewMs: averageOr(
      all.filter((d) => !d.isNew),
      DEFAULT_REVIEW_MS,
    ),
    newMs: averageOr(
      all.filter((d) => d.isNew),
      DEFAULT_NEW_MS,
    ),
  };
}

const averageOr = (cardDays: { ms: number }[], fallback: number) =>
  cardDays.length < MIN_CARD_DAYS
    ? fallback
    : cardDays.reduce((sum, d) => sum + d.ms, 0) / cardDays.length;

/**
 * How long a Session of `due` Cards (due reviews and Cards in their learning
 * steps, both at the review rate) and `fresh` New cards will take, in whole
 * milliseconds.
 */
export const estimateMs = (
  { due, fresh }: { due: number; fresh: number },
  { reviewMs, newMs }: CardDayAverages,
): number => Math.round(due * reviewMs + fresh * newMs);
