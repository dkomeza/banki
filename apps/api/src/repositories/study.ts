import type { StudyNextResponse, UndoReviewResponse } from "@banki/shared";
import { and, eq, isNull, lte, ne, or } from "drizzle-orm";
import type { Queryable } from "../db/database";
import { card, review } from "../db/schema";
import { previewIntervals, restore, scheduleOf } from "../scheduling/fsrs";
import { type QueueProgress, nextInQueue } from "../scheduling/queue";
import { findIn, isLiveDeck } from "./cards";
import {
  MEMORY_COLUMNS,
  deckRetentionOf,
  fromStored,
  lastReviewOf,
  schedulingSettingsOf,
} from "./reviews";

export type StudyRepository = ReturnType<typeof createStudyRepository>;

/**
 * Studying the User's Decks. Every query is scoped by the User (ADR-0001): a
 * deleted Deck, an unknown one and another User's are all "not_found".
 */
export function createStudyRepository(db: Queryable) {
  return {
    /**
     * The Card the Queue of the User's Deck `deckId` shows next (`nextInQueue`),
     * from its live Cards' state at `now` and the Session's progress, with its
     * schedule, kind, and each Rating's Interval preview at `now`; `next` is
     * null when the Queue is empty. `now` is for tests.
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
        const picked = nextInQueue(cards, progress, now);
        if (picked === null) return { next: null };
        const row = cards.find((c) => c.id === picked.id);
        const found = findIn(tx, userId, picked.id);
        if (row === undefined || found === undefined) return { next: null };
        const { id, createdAt: _, ...memory } = row;
        const intervals = previewIntervals(id, memory, {
          now,
          desiredRetention: deckRetentionOf(tx, userId, deckId),
          studyDay: schedulingSettingsOf(tx, userId).studyDay,
        });
        return {
          next: { card: found, schedule: scheduleOf(memory), kind: picked.kind, intervals },
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
