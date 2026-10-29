import type { StudyNextResponse } from "@banki/shared";
import { and, eq, isNull, lte, ne, or } from "drizzle-orm";
import type { Queryable } from "../db/database";
import { card } from "../db/schema";
import { scheduleOf } from "../scheduling/fsrs";
import { type QueueProgress, nextInQueue } from "../scheduling/queue";
import { findIn, isLiveDeck } from "./cards";
import { MEMORY_COLUMNS } from "./reviews";

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
     * schedule and kind; `next` is null when the Queue is empty. `now` is for
     * tests.
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
        const memory = cards.find((c) => c.id === picked.id);
        const found = findIn(tx, userId, picked.id);
        if (memory === undefined || found === undefined) return { next: null };
        return { next: { card: found, schedule: scheduleOf(memory), kind: picked.kind } };
      });
    },
  };
}
