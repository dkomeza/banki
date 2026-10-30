import { randomUUID } from "node:crypto";
import {
  CARD_STATES,
  DEFAULT_DAY_START_HOUR,
  DEFAULT_DESIRED_RETENTION,
  type RateCardResponse,
  type ReviewRequest,
  type StudyDaySettings,
} from "@banki/shared";
import { type SQLWrapper, and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Queryable } from "../db/database";
import { card, deck, review, user_settings } from "../db/schema";
import {
  type LastReview,
  type MemoryState,
  rate,
  reschedule,
  scheduleOf,
} from "../scheduling/fsrs";

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

const toStored = (memory: MemoryState): z.infer<typeof StoredMemoryState> => ({
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

/** What the User's Study days and Desired retention come from: their Settings, or the defaults. */
export function schedulingSettingsOf(
  db: Queryable,
  userId: string,
): { studyDay: StudyDaySettings; desiredRetention: number } {
  const row = db
    .select({
      timezone: user_settings.timezone,
      dayStartHour: user_settings.dayStartHour,
      desiredRetention: user_settings.desiredRetention,
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
  };
}

/** The Desired retention the User's Deck `deckId` schedules with: its own, or Settings'. */
export function deckRetentionOf(db: Queryable, userId: string, deckId: string): number {
  const own = db
    .select({ desiredRetention: deck.desiredRetention })
    .from(deck)
    .where(and(eq(deck.userId, userId), eq(deck.id, deckId)))
    .get()?.desiredRetention;
  return own ?? schedulingSettingsOf(db, userId).desiredRetention;
}

/**
 * Reschedules the User's Cards `cardIds` picks, deleted ones too, for a
 * Desired retention they now schedule with (`reschedule`): each one past its
 * learning steps gets a new due date; new Cards and those in learning steps
 * keep theirs. Expects to run inside the transaction that made the change.
 */
export function rescheduleCards(
  db: Queryable,
  userId: string,
  cardIds: SQLWrapper | string[],
  desiredRetention: number,
  now: Date,
): void {
  const { studyDay } = schedulingSettingsOf(db, userId);
  const rows = db
    .select({ id: card.id, ...MEMORY_COLUMNS })
    .from(card)
    .where(and(eq(card.userId, userId), inArray(card.id, cardIds), eq(card.state, "review")))
    .all();
  for (const { id, ...current } of rows) {
    const last = lastReviewOf(db, userId, id);
    if (last === undefined) continue;
    const next = reschedule(id, current, last, { now, desiredRetention, studyDay });
    db.update(card)
      .set({ dueAt: next.dueAt, scheduledDays: next.scheduledDays })
      .where(and(eq(card.userId, userId), eq(card.id, id)))
      .run();
  }
}

/** The newest Review of the User's Card `cardId`, with its ID, or undefined when it has none. */
export function lastReviewOf(
  db: Queryable,
  userId: string,
  cardId: string,
): (LastReview & { id: string }) | undefined {
  const last = db
    .select({
      id: review.id,
      reviewedAt: review.reviewedAt,
      rating: review.rating,
      before: review.cardBefore,
    })
    .from(review)
    .where(and(eq(review.userId, userId), eq(review.cardId, cardId)))
    .orderBy(desc(review.reviewedAt), desc(sql`rowid`))
    .limit(1)
    .get();
  return last === undefined ? undefined : { ...last, before: fromStored(last.before) };
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
 */
export function createReviewRepository(db: Queryable) {
  return {
    /**
     * Records a Rating of the User's Card `cardId` as a self-rated Review, and
     * reschedules the Card with FSRS at its Deck's Desired retention, all in
     * one transaction. Answers the Review and the Card's new schedule, or
     * "not_found" when it isn't a live Card in a live Deck of the User's.
     * `id` and `now` are for tests.
     */
    rate(
      userId: string,
      cardId: string,
      { rating, durationMs }: z.output<typeof ReviewRequest>,
      { id = randomUUID(), now = new Date() }: { id?: string; now?: Date } = {},
    ): RateCardResponse | "not_found" {
      return db.transaction(
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
          const { deckId, ...before } = found;
          const { studyDay } = schedulingSettingsOf(tx, userId);
          const after = rate(cardId, before, rating, {
            now,
            desiredRetention: deckRetentionOf(tx, userId, deckId),
            studyDay,
          });
          tx.insert(review)
            .values({
              id,
              userId,
              cardId,
              deckId,
              reviewedAt: now,
              rating,
              kind: "self-rated",
              durationMs,
              cardBefore: toStored(before),
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
              kind: "self-rated",
              durationMs,
            },
            schedule: scheduleOf(after),
          };
        },
        { behavior: "immediate" },
      );
    },
  };
}
