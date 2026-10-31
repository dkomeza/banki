import {
  DEFAULT_LEARNING_LIMIT,
  DEFAULT_NEW_CARD_BATCH,
  type StudyNextResponse,
  type StudyOverviewResponse,
  type UndoReviewResponse,
  addStudyDays,
  studyDayBounds,
  studyDayOf,
} from "@banki/shared";
import { and, eq, gte, isNull, lte, ne, or, sql } from "drizzle-orm";
import type { Queryable } from "../db/database";
import { card, review, user_settings } from "../db/schema";
import { ESTIMATE_WINDOW_DAYS, cardDayAverages, estimateMs } from "../scheduling/estimate";
import { previewIntervals, restore, scheduleOf } from "../scheduling/fsrs";
import { type QueueLimits, type QueueProgress, nextInQueue } from "../scheduling/queue";
import { findIn, isLiveDeck } from "./cards";
import {
  MEMORY_COLUMNS,
  deckRetentionOf,
  fromStored,
  lastReviewOf,
  schedulingSettingsOf,
} from "./reviews";

export type StudyRepository = ReturnType<typeof createStudyRepository>;

/** The User's New-card batch and Learning limit: their Settings, or the defaults. */
function queueLimitsOf(db: Queryable, userId: string): QueueLimits {
  const row = db
    .select({
      newCardBatch: user_settings.newCardBatch,
      learningLimit: user_settings.learningLimit,
    })
    .from(user_settings)
    .where(eq(user_settings.userId, userId))
    .get();
  return {
    newCardBatch: row?.newCardBatch ?? DEFAULT_NEW_CARD_BATCH,
    learningLimit: row?.learningLimit ?? DEFAULT_LEARNING_LIMIT,
  };
}

/**
 * Studying the User's Decks. Every query is scoped by the User (ADR-0001): a
 * deleted Deck, an unknown one and another User's are all "not_found".
 */
export function createStudyRepository(db: Queryable) {
  return {
    /**
     * The Card the Queue of the User's Deck `deckId` shows next (`nextInQueue`),
     * from its live Cards' state at `now`, the Session's progress and the
     * User's New-card batch and Learning limit as they are now, with its
     * schedule, kind, and each Rating's Interval preview at `now`; `next` is
     * null when the Queue is empty, with the New cards the batch held back in
     * `newHeld`. `now` is for tests.
     */
    next(
      userId: string,
      deckId: string,
      progress: QueueProgress,
      { now = new Date() }: { now?: Date } = {},
    ): StudyNextResponse | "not_found" {
      return db.transaction((tx) => {
        if (!isLiveDeck(tx, userId, deckId)) return "not_found";
        // Reviews not yet due never count, so they stay in the database.
        const cards = tx
          .select({ id: card.id, createdAt: card.createdAt, ...MEMORY_COLUMNS })
          .from(card)
          .where(
            and(
              eq(card.userId, userId),
              eq(card.deckId, deckId),
              isNull(card.deletedAt),
              or(ne(card.state, "review"), lte(card.dueAt, now)),
            ),
          )
          .all();
        const { next: picked, newHeld } = nextInQueue(
          cards,
          progress,
          queueLimitsOf(tx, userId),
          now,
        );
        if (picked === null) return { next: null, newHeld };
        const row = cards.find((c) => c.id === picked.id);
        const found = findIn(tx, userId, picked.id);
        if (row === undefined || found === undefined) return { next: null, newHeld: 0 };
        const { id, createdAt: _, ...memory } = row;
        const intervals = previewIntervals(id, memory, {
          now,
          desiredRetention: deckRetentionOf(tx, userId, deckId),
          studyDay: schedulingSettingsOf(tx, userId).studyDay,
        });
        return {
          next: {
            card: found,
            schedule: scheduleOf(memory),
            kind: picked.kind,
            intervals,
          },
          newHeld: 0,
        };
      });
    },

    /**
     * What Study on the User's Deck `deckId` brings at `now`, from its live
     * Cards and the Timezone, Day start and New-card batch as they are now:
     * the review Cards due before the next Day start plus every Card in its
     * learning steps, the New cards a Session introduces (at most a batch) of
     * all its New cards, how long they will take (`cardDayAverages` over the
     * User's Reviews in every Deck), and the first Study day after today with
     * review Cards due, with how many. `now` is for tests.
     */
    overview(
      userId: string,
      deckId: string,
      { now = new Date() }: { now?: Date } = {},
    ): StudyOverviewResponse | "not_found" {
      return db.transaction((tx) => {
        if (!isLiveDeck(tx, userId, deckId)) return "not_found";
        const { studyDay } = schedulingSettingsOf(tx, userId);
        const today = studyDayOf(now, studyDay);
        const tomorrow = studyDayBounds(today, studyDay).end.getTime();
        const cards = tx
          .select({ state: card.state, dueAt: card.dueAt })
          .from(card)
          .where(and(eq(card.userId, userId), eq(card.deckId, deckId), isNull(card.deletedAt)))
          .all();

        let due = 0;
        let newTotal = 0;
        const later = new Map<string, number>();
        for (const { state, dueAt } of cards) {
          if (state === "new") newTotal += 1;
          else if (state !== "review") due += 1;
          else if (dueAt === null || dueAt.getTime() < tomorrow) due += 1;
          else {
            const day = studyDayOf(dueAt, studyDay);
            later.set(day, (later.get(day) ?? 0) + 1);
          }
        }
        const fresh = Math.min(newTotal, queueLimitsOf(tx, userId).newCardBatch);
        const nextDay = [...later.keys()].toSorted()[0];

        const since = studyDayBounds(addStudyDays(today, -(ESTIMATE_WINDOW_DAYS - 1)), studyDay);
        const reviews = tx
          .select({
            cardId: review.cardId,
            reviewedAt: review.reviewedAt,
            durationMs: review.durationMs,
            wasNew: sql<number>`json_extract(${review.cardBefore}, '$.state') = 'new'`,
          })
          .from(review)
          .where(and(eq(review.userId, userId), gte(review.reviewedAt, since.start)))
          .all()
          .map((r) => ({ ...r, wasNew: Boolean(r.wasNew) }));

        return {
          due,
          new: fresh,
          newTotal,
          estimateMs: estimateMs({ due, fresh }, cardDayAverages(reviews, { now, studyDay })),
          nextDue: nextDay === undefined ? null : { day: nextDay, count: later.get(nextDay) ?? 0 },
        };
      });
    },

    /**
     * Undoes the User's Review `reviewId` (ADR-0025): deletes it and puts its
     * Card's memory state back to the one it kept from before it, rescheduled
     * when the Deck's Desired retention changed since (`restore`). Answers the
     * Card, its restored schedule and each Rating's Interval preview at `now`.
     * "not_newest" when the Card has a newer Review; "not_found" for a missing
     * Review, another User's, or one whose Card is deleted or in a deleted
     * Deck. `now` is for tests.
     */
    undo(
      userId: string,
      reviewId: string,
      { now = new Date() }: { now?: Date } = {},
    ): UndoReviewResponse | "not_found" | "not_newest" {
      return db.transaction(
        (tx) => {
          const undone = tx
            .select({ cardId: review.cardId, before: review.cardBefore })
            .from(review)
            .where(and(eq(review.userId, userId), eq(review.id, reviewId)))
            .get();
          if (undone === undefined) return "not_found";
          const found = findIn(tx, userId, undone.cardId);
          if (found === undefined) return "not_found";
          if (lastReviewOf(tx, userId, undone.cardId)?.id !== reviewId) return "not_newest";

          tx.delete(review)
            .where(and(eq(review.userId, userId), eq(review.id, reviewId)))
            .run();
          const settings = {
            now,
            desiredRetention: deckRetentionOf(tx, userId, found.deckId),
            studyDay: schedulingSettingsOf(tx, userId).studyDay,
          };
          const restored = restore(
            undone.cardId,
            fromStored(undone.before),
            lastReviewOf(tx, userId, undone.cardId),
            settings,
          );
          tx.update(card)
            .set(restored)
            .where(and(eq(card.userId, userId), eq(card.id, undone.cardId)))
            .run();
          return {
            card: found,
            schedule: scheduleOf(restored),
            intervals: previewIntervals(undone.cardId, restored, settings),
          };
        },
        { behavior: "immediate" },
      );
    },
  };
}
