import { type SQL, and, asc, count, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { Queryable } from "../db/database";
import { card, deck, progress_reset, review } from "../db/schema";
import { type MemoryState, NEW_MEMORY_STATE, type Parameters, rate } from "../scheduling/fsrs";
import {
  MEMORY_COLUMNS,
  deckParametersLookup,
  deckRetentionOf,
  fromStored,
  schedulingSettingsOf,
  toStored,
} from "./reviews";

// Replaying Cards under the Parameters they now schedule with (ADR-0029,
// ADR-0033): after new Parameters apply, and after a Move into a Deck with
// other Parameters.

/** The memory state a replay works out again; the due date and Interval stay as they were. */
const replayed = ({ state, stability, difficulty, reps, lapses, learningStep }: MemoryState) => ({
  state,
  stability,
  difficulty,
  reps,
  lapses,
  learningStep,
});

const sameReplayed = (a: MemoryState, b: MemoryState) =>
  a.state === b.state &&
  a.stability === b.stability &&
  a.difficulty === b.difficulty &&
  a.reps === b.reps &&
  a.lapses === b.lapses &&
  a.learningStep === b.learningStep;

/** Whether two sets of Parameters are the same weights. */
export const sameParameters = (a: Parameters, b: Parameters) =>
  a.length === b.length && a.every((weight, i) => weight === b[i]);

/**
 * Which of the User's Cards, live or deleted, a replay works out again: all
 * of them; those of the Decks that follow the overall Parameters; one Deck's;
 * or the Cards `cardIds`.
 */
export type ReplayScope = "all" | "overall" | { deckId: string } | { cardIds: readonly string[] };

const cardsIn = (db: Queryable, userId: string, scope: ReplayScope): SQL | undefined => {
  if (scope === "all") return eq(card.userId, userId);
  if (scope === "overall") {
    const following = db
      .select({ id: deck.id })
      .from(deck)
      .where(and(eq(deck.userId, userId), isNull(deck.fsrsParameters)));
    return and(eq(card.userId, userId), inArray(card.deckId, following));
  }
  if ("deckId" in scope) return and(eq(card.userId, userId), eq(card.deckId, scope.deckId));
  return and(eq(card.userId, userId), inArray(card.id, [...scope.cardIds]));
};

/**
 * Replays the User's Cards `scope` picks, live or deleted, each under its
 * Deck's Parameters (`deckSchedulingOf`), from New through its Reviews since
 * its newest Progress reset, in the Write order. Each Review's `cardBefore`
 * and the Card get the memory state the replay works out (`replayed`); their
 * due dates and Intervals stay as they were, and so does each Rating's input
 * to the next, so a replay under unchanged Parameters changes nothing.
 * Removed Cards have no Card to replay. Expects to run inside the immediate
 * transaction that made the change.
 */
export function replayCards(db: Queryable, userId: string, scope: ReplayScope): void {
  const picked = cardsIn(db, userId, scope);
  const cards = db
    .select({ id: card.id, deckId: card.deckId, ...MEMORY_COLUMNS })
    .from(card)
    .where(picked)
    .all();
  if (cards.length === 0) return;

  const pickedIds = db.select({ id: card.id }).from(card).where(picked);
  const newestReset = new Map(
    db
      .select({ cardId: progress_reset.cardId, seq: sql<number>`max(${progress_reset.seq})` })
      .from(progress_reset)
      .where(and(eq(progress_reset.userId, userId), inArray(progress_reset.cardId, pickedIds)))
      .groupBy(progress_reset.cardId)
      .all()
      .map(({ cardId, seq }) => [cardId, seq]),
  );
  const reviews = db
    .select({
      id: review.id,
      cardId: review.cardId,
      seq: review.seq,
      reviewedAt: review.reviewedAt,
      rating: review.rating,
      before: review.cardBefore,
    })
    .from(review)
    .where(and(eq(review.userId, userId), inArray(review.cardId, pickedIds)))
    .orderBy(asc(review.seq))
    .all();
  const reviewsOf = new Map<string, typeof reviews>();
  for (const one of reviews) {
    if (one.seq <= (newestReset.get(one.cardId) ?? Number.NEGATIVE_INFINITY)) continue;
    const list = reviewsOf.get(one.cardId);
    if (list === undefined) reviewsOf.set(one.cardId, [one]);
    else list.push(one);
  }

  const { studyDay } = schedulingSettingsOf(db, userId);
  const parametersOf = deckParametersLookup(db, userId);
  const retentions = new Map<string, number>();
  const retentionOf = (deckId: string) => {
    let retention = retentions.get(deckId);
    if (retention === undefined) {
      retention = deckRetentionOf(db, userId, deckId);
      retentions.set(deckId, retention);
    }
    return retention;
  };

  for (const { id: cardId, deckId, ...current } of cards) {
    const list = reviewsOf.get(cardId);
    if (list === undefined) continue;
    const settings = {
      studyDay,
      desiredRetention: retentionOf(deckId),
      parameters: parametersOf(deckId),
    };
    let memory = NEW_MEMORY_STATE;
    for (const one of list) {
      const stored = fromStored(one.before);
      const before = { ...stored, ...replayed(memory) };
      if (!sameReplayed(before, stored)) {
        db.update(review)
          .set({ cardBefore: toStored(before) })
          .where(and(eq(review.userId, userId), eq(review.id, one.id)))
          .run();
      }
      memory = rate(cardId, before, one.rating, { ...settings, now: one.reviewedAt });
    }
    if (!sameReplayed(current, memory)) {
      db.update(card)
        .set(replayed(memory))
        .where(and(eq(card.userId, userId), eq(card.id, cardId)))
        .run();
    }
  }
}

/**
 * How many of the User's Decks have Parameters of their own: the live ones,
 * or, with `deleted`, the deleted ones too, which keep theirs for a Restore.
 */
export const decksWithOwnParameters = (
  db: Queryable,
  userId: string,
  { deleted = false }: { deleted?: boolean } = {},
): number =>
  db
    .select({ n: count() })
    .from(deck)
    .where(
      and(
        eq(deck.userId, userId),
        isNotNull(deck.fsrsParameters),
        deleted ? undefined : isNull(deck.deletedAt),
      ),
    )
    .get()?.n ?? 0;

/** The User's Decks with their own Parameters go back to following the overall ones. */
export const clearDeckParameters = (db: Queryable, userId: string): void => {
  db.update(deck)
    .set({ fsrsParameters: null })
    .where(and(eq(deck.userId, userId), isNotNull(deck.fsrsParameters)))
    .run();
};
