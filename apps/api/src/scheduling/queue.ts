import type { CardState, QueueKind } from "@banki/shared";
import { predictedRecall } from "./fsrs";

// The Queue (CONTEXT.md): which of a Deck's Cards a Session shows next. It is
// stateless: each answer is worked out afresh from the Cards' state, `now`
// and how many review and new Cards the Session has shown.

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

/** The Session's progress: the review and new Cards it has shown, and the Card it showed last. */
export type QueueProgress = {
  reviewsShown: number;
  newShown: number;
  /** The ID of the Card just shown, if any. */
  after?: string | undefined;
};

export type QueuePick = { id: string; kind: QueueKind };

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
 * empty: no Card is due and none is in learning.
 *
 * 1. A learning Card whose step is over goes first, the one due longest ago
 *    first, but never the Card just shown (`after`) while any other Card is
 *    left.
 * 2. Otherwise a due review or a new Card: due reviews lowest Predicted recall
 *    first (then the earlier due, then the ID), with the new Cards, in the
 *    order they were written, at evenly spaced, centered positions among
 *    them: new Card `k` of `n` in `t` is at position `⌊(k+½)·t/n⌋`, where `t`
 *    and `n` count those the Session has shown too. When the reviews run out,
 *    the rest of the new Cards follow.
 * 3. With neither left, the learning Card with the earliest due time is shown
 *    early.
 */
export function nextInQueue(
  cards: readonly QueueCard[],
  { reviewsShown, newShown, after }: QueueProgress,
  now: Date,
): QueuePick | null {
  const learning = cards.filter((c) => isLearning(c.state) && c.dueAt !== null);
  const reviews = cards.filter(
    (c) => c.state === "review" && c.dueAt !== null && c.dueAt.getTime() <= now.getTime(),
  );
  const fresh = cards.filter((c) => c.state === "new");

  const learningDue = learning
    .filter((c) => c.dueAt !== null && c.dueAt.getTime() <= now.getTime())
    .toSorted(byThenId((c) => c.dueAt?.getTime() ?? 0));
  const others = reviews.length + fresh.length + learning.filter((c) => c.id !== after).length;
  const dueLearning = learningDue.find((c) => c.id !== after || others === 0);
  if (dueLearning !== undefined) return { id: dueLearning.id, kind: "learning" };

  if (fresh.length > 0 || reviews.length > 0) {
    const newCount = fresh.length + newShown;
    const total = reviews.length + fresh.length + reviewsShown + newShown;
    const position = reviewsShown + newShown;
    const newPosition = Math.floor(((newShown + 0.5) * total) / newCount);
    if (reviews.length === 0 || (fresh.length > 0 && position >= newPosition)) {
      const first = fresh.toSorted(byThenId((c) => c.createdAt.getTime()))[0];
      if (first !== undefined) return { id: first.id, kind: "new" };
    }
    const recall = new Map(reviews.map((c) => [c.id, predictedRecall(c, now)]));
    const mostAtRisk = reviews.toSorted(
      (a, b) =>
        (recall.get(a.id) ?? 0) - (recall.get(b.id) ?? 0) ||
        byThenId<QueueCard>((c) => c.dueAt?.getTime() ?? 0)(a, b),
    )[0];
    if (mostAtRisk !== undefined) return { id: mostAtRisk.id, kind: "review" };
  }

  const early = earliestDue(learning, after);
  return early === undefined ? null : { id: early.id, kind: "learning" };
}
