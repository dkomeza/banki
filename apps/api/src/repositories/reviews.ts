import { randomUUID } from "node:crypto";
import {
  CARD_STATES,
  type CardHistoryEntry,
  DEFAULT_DAY_START_HOUR,
  DEFAULT_DESIRED_RETENTION,
  type RateCardResponse,
  type ReviewRequest,
  type StudyDaySettings,
} from "@banki/shared";
import { type SQLWrapper, and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Queryable } from "../db/database";
import { card, deck, progress_reset, review, user_settings } from "../db/schema";
import type { TimedReview } from "../scheduling/estimate";
import {
  DEFAULT_PARAMETERS,
  type LastReview,
  type MemoryState,
  type Parameters,
  rate,
  reschedule,
  scheduleOf,
} from "../scheduling/fsrs";
import { nextSeq } from "./write-order";

export type ReviewRepository = ReturnType<typeof createReviewRepository>;

/** A Card row's memory state columns. */
export const MEMORY_COLUMNS = {
  state: card.state,
  dueAt: card.dueAt,
  stability: card.stability,
  difficulty: card.difficulty,
  reps: card.reps,
  lapses: card.lapses,
  scheduledDays: card.scheduledDays,
  learningStep: card.learningStep,
  lastReviewAt: card.lastReviewAt,
} as const;

/** A memory state as a Review's `cardBefore` keeps it: JSON, its times ISO 8601. */
const StoredMemoryState = z.object({
  state: z.enum(CARD_STATES),
  dueAt: z.iso.datetime().nullable(),
  stability: z.number(),
  difficulty: z.number(),
  reps: z.number(),
  lapses: z.number(),
  scheduledDays: z.number(),
  learningStep: z.number(),
  lastReviewAt: z.iso.datetime().nullable(),
});

export const toStored = (memory: MemoryState): z.infer<typeof StoredMemoryState> => ({
  ...memory,
  dueAt: memory.dueAt?.toISOString() ?? null,
  lastReviewAt: memory.lastReviewAt?.toISOString() ?? null,
});

export const fromStored = (stored: unknown): MemoryState => {
  const parsed = StoredMemoryState.parse(stored);
  return {
    ...parsed,
    dueAt: parsed.dueAt === null ? null : new Date(parsed.dueAt),
    lastReviewAt: parsed.lastReviewAt === null ? null : new Date(parsed.lastReviewAt),
  };
};

/**
 * What the User's Study days, Desired retention and overall Parameters come
 * from: their Settings, or the defaults. What schedules a Card takes its
 * Deck's Parameters from `deckSchedulingOf`.
 */
export function schedulingSettingsOf(
  db: Queryable,
  userId: string,
): { studyDay: StudyDaySettings; desiredRetention: number; parameters: Parameters } {
  const row = db
    .select({
      timezone: user_settings.timezone,
      dayStartHour: user_settings.dayStartHour,
      desiredRetention: user_settings.desiredRetention,
      fsrsParameters: user_settings.fsrsParameters,
    })
    .from(user_settings)
    .where(eq(user_settings.userId, userId))
    .get();
  return {
    studyDay: {
      timezone: row?.timezone ?? null,
      dayStartHour: row?.dayStartHour ?? DEFAULT_DAY_START_HOUR,
    },
    desiredRetention: row?.desiredRetention ?? DEFAULT_DESIRED_RETENTION,
    parameters: row?.fsrsParameters ?? DEFAULT_PARAMETERS,
  };
}

/** The Desired retention the User's Deck `deckId` schedules with: its own, or Settings'. */
export function deckRetentionOf(db: Queryable, userId: string, deckId: string): number {
  return deckSchedulingOf(db, userId, deckId).desiredRetention;
}

/**
 * What the User's Deck `deckId` schedules its Cards with: the Study days,
 * its Desired retention (its own, or Settings') and its Parameters (its own,
 * or the overall ones; ADR-0033). Everything that schedules a Card takes its
 * Parameters from here.
 */
export function deckSchedulingOf(
  db: Queryable,
  userId: string,
  deckId: string,
): { studyDay: StudyDaySettings; desiredRetention: number; parameters: Parameters } {
  const own = db
    .select({ desiredRetention: deck.desiredRetention, parameters: deck.fsrsParameters })
    .from(deck)
    .where(and(eq(deck.userId, userId), eq(deck.id, deckId)))
    .get();
  const settings = schedulingSettingsOf(db, userId);
  return {
    studyDay: settings.studyDay,
    desiredRetention: own?.desiredRetention ?? settings.desiredRetention,
    parameters: own?.parameters ?? settings.parameters,
  };
}

/** The Parameters each of the User's Decks schedules with, looked up once a Deck. */
export function deckParametersLookup(
  db: Queryable,
  userId: string,
): (deckId: string) => Parameters {
  const known = new Map<string, Parameters>();
  return (deckId) => {
    let parameters = known.get(deckId);
    if (parameters === undefined) {
      parameters = deckSchedulingOf(db, userId, deckId).parameters;
      known.set(deckId, parameters);
    }
    return parameters;
  };
}

/**
 * Reschedules the User's Cards `cardIds` picks, deleted ones too, for a
 * Desired retention they now schedule with (`reschedule`): each one past its
 * learning steps gets a new due date; new Cards and those in learning steps
 * keep theirs, each under its Deck's Parameters. Expects to run inside the
 * transaction that made the change.
 */
export function rescheduleCards(
  db: Queryable,
  userId: string,
  cardIds: SQLWrapper | string[],
  desiredRetention: number,
  now: Date,
): void {
  const { studyDay } = schedulingSettingsOf(db, userId);
  const parametersOf = deckParametersLookup(db, userId);
  const rows = db
    .select({ id: card.id, deckId: card.deckId, ...MEMORY_COLUMNS })
    .from(card)
    .where(and(eq(card.userId, userId), inArray(card.id, cardIds), eq(card.state, "review")))
    .all();
  for (const { id, deckId, ...current } of rows) {
    const last = lastReviewOf(db, userId, id);
    if (last === undefined) continue;
    const next = reschedule(id, current, last, {
      now,
      desiredRetention,
      studyDay,
      parameters: parametersOf(deckId),
    });
    db.update(card)
      .set({ dueAt: next.dueAt, scheduledDays: next.scheduledDays })
      .where(and(eq(card.userId, userId), eq(card.id, id)))
      .run();
  }
}

/**
 * The newest Review of the User's Card `cardId` in their Write order (`seq`),
 * with its ID and `seq`, or undefined when it has none.
 */
export function lastReviewOf(
  db: Queryable,
  userId: string,
  cardId: string,
): (LastReview & { id: string; seq: number }) | undefined {
  const last = db
    .select({
      id: review.id,
      seq: review.seq,
      reviewedAt: review.reviewedAt,
      rating: review.rating,
      before: review.cardBefore,
    })
    .from(review)
    .where(and(eq(review.userId, userId), eq(review.cardId, cardId)))
    .orderBy(desc(review.seq))
    .limit(1)
    .get();
  return last === undefined ? undefined : { ...last, before: fromStored(last.before) };
}

/**
 * The User's Reviews in every Deck from `since` on, as the time estimates
 * take them (`cardDayAverages`), with the Deck each was in.
 */
export function timedReviewsSince(
  db: Queryable,
  userId: string,
  since: Date,
): (TimedReview & { deckId: string })[] {
  return db
    .select({
      cardId: review.cardId,
      deckId: review.deckId,
      reviewedAt: review.reviewedAt,
      durationMs: review.durationMs,
      wasNew: sql<number>`json_extract(${review.cardBefore}, '$.state') = 'new'`,
    })
    .from(review)
    .where(and(eq(review.userId, userId), gte(review.reviewedAt, since)))
    .all()
    .map((r) => ({ ...r, wasNew: Boolean(r.wasNew) }));
}

/** Whether the User has any Review at all, of a Card that is gone too. */
export function hasReviews(db: Queryable, userId: string): boolean {
  return (
    db.select({ id: review.id }).from(review).where(eq(review.userId, userId)).limit(1).get() !==
    undefined
  );
}

/**
 * The User's Reviews, and Rating their Cards. Every query is scoped by the
 * User (ADR-0001). A Card is rated only while it is live in a live Deck.
 * `onRated` hears of each Rating once it has committed: the API starts an
 * automatic Tuning from it (`TuningRepository.afterRating`).
 */
export function createReviewRepository(
  db: Queryable,
  { onRated }: { onRated?: (userId: string) => void } = {},
) {
  return {
    /**
     * Records a Rating of the User's Card `cardId` as a Review, graded with
     * the `suggestedRating` and `model` when given and self-rated otherwise
     * (ADR-0028), and reschedules the Card with FSRS at its Deck's Desired
     * retention, alike for both kinds, all in one transaction, under the
     * Deck's Parameters. Answers the Review and the Card's new schedule, or
     * "not_found" when it isn't a live Card in a live Deck of the User's.
     * `id` and `now` are for tests.
     */
    rate(
      userId: string,
      cardId: string,
      { rating, durationMs, suggestedRating, model }: z.output<typeof ReviewRequest>,
      { id = randomUUID(), now = new Date() }: { id?: string; now?: Date } = {},
    ): RateCardResponse | "not_found" {
      const rated = db.transaction<RateCardResponse | "not_found">(
        (tx) => {
          const found = tx
            .select({ deckId: card.deckId, ...MEMORY_COLUMNS })
            .from(card)
            .innerJoin(deck, eq(deck.id, card.deckId))
            .where(
              and(
                eq(card.userId, userId),
                eq(card.id, cardId),
                isNull(card.deletedAt),
                eq(deck.userId, userId),
                isNull(deck.deletedAt),
              ),
            )
            .get();
          if (found === undefined) return "not_found";
          const graded =
            suggestedRating !== undefined && model !== undefined
              ? { kind: "graded" as const, suggestedRating, model }
              : { kind: "self-rated" as const, suggestedRating: null, model: null };
          const { deckId, ...before } = found;
          const after = rate(cardId, before, rating, {
            now,
            ...deckSchedulingOf(tx, userId, deckId),
          });
          tx.insert(review)
            .values({
              id,
              userId,
              cardId,
              deckId,
              reviewedAt: now,
              rating,
              ...graded,
              durationMs,
              cardBefore: toStored(before),
              seq: nextSeq(tx, userId),
            })
            .run();
          tx.update(card)
            .set(after)
            .where(and(eq(card.userId, userId), eq(card.id, cardId)))
            .run();
          return {
            review: {
              id,
              cardId,
              deckId,
              reviewedAt: now.toISOString(),
              rating,
              ...graded,
              durationMs,
            },
            schedule: scheduleOf(after),
          };
        },
        { behavior: "immediate" },
      );
      if (rated !== "not_found") onRated?.(userId);
      return rated;
    },

    /**
     * The history of the User's Card `cardId` (CONTEXT.md: Review): every
     * Review of it, from any Deck it was in (ADR-0021), and every Progress
     * reset of it, newest first in the Write order, never by moments
     * (ADR-0026). An undone Review is gone (ADR-0025). "not_found" when it
     * isn't a live Card in a live Deck of the User's.
     */
    history(userId: string, cardId: string): CardHistoryEntry[] | "not_found" {
      return db.transaction((tx) => {
        const live = tx
          .select({ id: card.id })
          .from(card)
          .innerJoin(deck, eq(deck.id, card.deckId))
          .where(
            and(
              eq(card.userId, userId),
              eq(card.id, cardId),
              isNull(card.deletedAt),
              eq(deck.userId, userId),
              isNull(deck.deletedAt),
            ),
          )
          .get();
        if (live === undefined) return "not_found";
        const reviews = tx
          .select({
            seq: review.seq,
            id: review.id,
            cardId: review.cardId,
            deckId: review.deckId,
            reviewedAt: review.reviewedAt,
            rating: review.rating,
            kind: review.kind,
            suggestedRating: review.suggestedRating,
            model: review.model,
            durationMs: review.durationMs,
          })
          .from(review)
          .where(and(eq(review.userId, userId), eq(review.cardId, cardId)))
          .all();
        const resets = tx
          .select({
            seq: progress_reset.seq,
            id: progress_reset.id,
            resetAt: progress_reset.resetAt,
          })
          .from(progress_reset)
          .where(and(eq(progress_reset.userId, userId), eq(progress_reset.cardId, cardId)))
          .all();
        const placed: { seq: number; entry: CardHistoryEntry }[] = [
          ...reviews.map(({ seq, reviewedAt, ...r }) => ({
            seq,
            entry: { type: "review" as const, ...r, reviewedAt: reviewedAt.toISOString() },
          })),
          ...resets.map(({ seq, id, resetAt }) => ({
            seq,
            entry: { type: "progress-reset" as const, id, resetAt: resetAt.toISOString() },
          })),
        ];
        return placed.toSorted((a, b) => b.seq - a.seq).map(({ entry }) => entry);
      });
    },
  };
}
