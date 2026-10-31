import type { CardState, QueueKind } from "@banki/shared";
import { predictedRecall } from "./fsrs";

// The Queue (CONTEXT.md): which of a Deck's Cards a Session shows next. It is
// stateless: each answer is worked out afresh from the Cards' state, `now`
// how many review and new Cards the Session has shown, and the Settings that
// pace its New cards (CONTEXT.md: New-card batch, Learning limit).

/** What the Queue needs to know of a live Card in the Deck. */
export type QueueCard = {
  id: string;
  state: CardState;
  /** Null while new. */
  dueAt: Date | null;
  stability: number;
  lastReviewAt: Date | null;
  createdAt: Date;
};

/**
 * The Session's progress: the review and new Cards it has shown, the New-card
 * batches it has been given, and the Card it showed last.
 */
export type QueueProgress = {
  reviewsShown: number;
  newShown: number;
  /** How many New-card batches the Session has been given: 1 at its start. */
  batches: number;
  /** The ID of the Card just shown, if any. */
  after?: string | undefined;
};

/** The User's Settings that pace New cards: the New-card batch and the Learning limit. */
export type QueueLimits = { newCardBatch: number; learningLimit: number };

export type QueuePick = { id: string; kind: QueueKind };

/**
 * What the Queue answers: the Card it shows next, or null when it is empty,
 * and, when it is empty, how many New cards the New-card batch held back.
 */
export type QueueAnswer = { next: QueuePick | null; newHeld: number };

const isLearning = (state: CardState) => state === "learning" || state === "relearning";

/** Orders by `key` ascending, then by ID. */
const byThenId =
  <T extends { id: string }>(key: (item: T) => number) =>
  (a: T, b: T) =>
    key(a) - key(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** The learning Card with the earliest due time, the Card just shown only when no other is left. */
function earliestDue(learning: QueueCard[], after: string | undefined): QueueCard | undefined {
  const sorted = learning.toSorted(byThenId((c) => c.dueAt?.getTime() ?? 0));
  return sorted.find((c) => c.id !== after) ?? sorted[0];
}

/**
 * The Card the Queue shows next, and its kind, or null when the Queue is
 * empty: no Card it may show is due and none is in learning.
 *
 * New cards are paced by `limits`. The Session may introduce
 * `newCardBatch × batches` of them in all, counting those it has shown; once
 * it has, the rest are held back, and an empty Queue says how many
 * (`newHeld`). While the Deck has `learningLimit` or more Cards in learning
 * or relearning, none is introduced: a due review comes where one would.
 *
 * 1. A learning Card whose step is over goes first, the one due longest ago
 *    first, but never the Card just shown (`after`) while any other Card is
 *    left.
 * A review Card is due once its due moment is before `nextDayStart`, the next
 * Day start after `now` (ADR-0024); a learning Card once its step is over at
 * `now`.
 *
 * 2. Otherwise a due review or a new Card: due reviews lowest Predicted recall
 *    first (then the earlier due, then the ID), with the new Cards, in the
 *    order they were written, at evenly spaced, centered positions among
 *    them: new Card `k` of `n` in `t` is at position `⌊(k+½)·t/n⌋`, where `t`
 *    and `n` count those the Session has shown too, and of the new Cards left
 *    only those the batch still allows. When the reviews run out, the rest of
 *    the allowed new Cards follow.
 * 3. With neither left, the learning Card with the earliest due time is shown
 *    early.
 */
export function nextInQueue(
  cards: readonly QueueCard[],
  { reviewsShown, newShown, batches, after }: QueueProgress,
  { newCardBatch, learningLimit }: QueueLimits,
  now: Date,
  nextDayStart: Date,
): QueueAnswer {
  const learning = cards.filter((c) => isLearning(c.state) && c.dueAt !== null);
  const reviews = cards.filter(
    (c) => c.state === "review" && c.dueAt !== null && c.dueAt.getTime() < nextDayStart.getTime(),
  );
  const fresh = cards.filter((c) => c.state === "new");
  // The New cards the batch still allows, of which none while the Learning limit is reached.
  const allowed = Math.min(fresh.length, Math.max(0, newCardBatch * batches - newShown));
  const paused = cards.filter((c) => isLearning(c.state)).length >= learningLimit;
  const introducing = paused ? 0 : allowed;

  const learningDue = learning
    .filter((c) => c.dueAt !== null && c.dueAt.getTime() <= now.getTime())
    .toSorted(byThenId((c) => c.dueAt?.getTime() ?? 0));
  const others = reviews.length + introducing + learning.filter((c) => c.id !== after).length;
  const dueLearning = learningDue.find((c) => c.id !== after || others === 0);
  if (dueLearning !== undefined) return shows(dueLearning, "learning");

  if (introducing > 0 || reviews.length > 0) {
    // Spaced by what the batch allows, whether or not the Learning limit pauses them.
    const newCount = allowed + newShown;
    const total = reviews.length + allowed + reviewsShown + newShown;
    const position = reviewsShown + newShown;
    const newPosition = Math.floor(((newShown + 0.5) * total) / newCount);
    if (introducing > 0 && (reviews.length === 0 || position >= newPosition)) {
      const first = fresh.toSorted(byThenId((c) => c.createdAt.getTime()))[0];
      if (first !== undefined) return shows(first, "new");
    }
    const recall = new Map(reviews.map((c) => [c.id, predictedRecall(c, now)]));
    const mostAtRisk = reviews.toSorted(
      (a, b) =>
        (recall.get(a.id) ?? 0) - (recall.get(b.id) ?? 0) ||
        byThenId<QueueCard>((c) => c.dueAt?.getTime() ?? 0)(a, b),
    )[0];
    if (mostAtRisk !== undefined) return shows(mostAtRisk, "review");
  }

  const early = earliestDue(learning, after);
  if (early !== undefined) return shows(early, "learning");
  // Empty: the Learning limit can't be what holds them, as no Card is in learning.
  return { next: null, newHeld: fresh.length };
}

const shows = (card: QueueCard, kind: QueueKind): QueueAnswer => ({
  next: { id: card.id, kind },
  newHeld: 0,
});
