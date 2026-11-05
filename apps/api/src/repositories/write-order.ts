import { eq, max } from "drizzle-orm";
import type { Queryable } from "../db/database";
import { progress_reset, review } from "../db/schema";

/**
 * The next place in the User's Write order, which their Reviews and Progress
 * resets share (`seq`; ADR-0026): one past the newest of either. Expects to run
 * inside the immediate transaction that writes the row, so no other write
 * takes the same place.
 */
export function nextSeq(db: Queryable, userId: string): number {
  const reviews = db
    .select({ seq: max(review.seq) })
    .from(review)
    .where(eq(review.userId, userId))
    .get()?.seq;
  const resets = db
    .select({ seq: max(progress_reset.seq) })
    .from(progress_reset)
    .where(eq(progress_reset.userId, userId))
    .get()?.seq;
  return Math.max(reviews ?? 0, resets ?? 0) + 1;
}
