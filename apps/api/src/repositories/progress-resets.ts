import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Queryable } from "../db/database";
import { card, progress_reset } from "../db/schema";
import { NEW_MEMORY_STATE } from "../scheduling/fsrs";
import { nextSeq } from "./write-order";

// Progress resets (CONTEXT.md, ADR-0026): a studied Card put back to New while
// it is edited, its Reviews left in place and the reset logged.

/**
 * Puts the User's Card `cardId` back to New (`NEW_MEMORY_STATE`) and logs the
 * Progress reset, unless the Card is New already, which logs nothing. Answers
 * whether it reset. Expects to run inside the transaction of the edit that
 * asked for it, on a Card known to be the User's. `id` is for tests.
 */
export function resetProgress(
  db: Queryable,
  userId: string,
  cardId: string,
  now: Date,
  id: string = randomUUID(),
): boolean {
  const current = db
    .select({ state: card.state })
    .from(card)
    .where(and(eq(card.userId, userId), eq(card.id, cardId)))
    .get();
  if (current === undefined || current.state === "new") return false;
  db.update(card)
    .set(NEW_MEMORY_STATE)
    .where(and(eq(card.userId, userId), eq(card.id, cardId)))
    .run();
  db.insert(progress_reset)
    .values({ id, userId, cardId, resetAt: now, seq: nextSeq(db, userId) })
    .run();
  return true;
}

/** Whether the User has any Progress reset at all, of a Card that is gone too. */
export function hasProgressResets(db: Queryable, userId: string): boolean {
  return (
    db
      .select({ id: progress_reset.id })
      .from(progress_reset)
      .where(eq(progress_reset.userId, userId))
      .limit(1)
      .get() !== undefined
  );
}
