import { z } from "zod";
import { CardResponse } from "./cards";
import { CardSchedule } from "./scheduling";

// Studying a Deck (CONTEXT.md: Session, Queue). The API orders the Queue; the
// study screen asks it for the next Card.

/** Why the Queue shows a Card: it is new, back from a learning step, or a due review. */
export const QUEUE_KINDS = ["new", "learning", "review"] as const;
export const QueueKind = z.enum(QUEUE_KINDS);
export type QueueKind = z.infer<typeof QueueKind>;

/** A count the Session keeps: a non-negative whole number, as a query string gives it; 0 when left out. */
const ShownCount = z
  .string()
  .regex(/^\d+$/, "Expected a whole number from 0")
  .transform(Number)
  .refine(Number.isSafeInteger, "Expected a whole number from 0")
  .default(0);

/**
 * The query of `GET /api/decks/:deckId/study/next`: how many review and new
 * Cards the Session has shown (each counted the first time, by the `kind` it
 * was answered with; a learning Card coming back counts for neither), and the
 * ID of the Card just shown, if any; an empty one is none.
 */
export const StudyNextQuery = z.object({
  reviewsShown: ShownCount,
  newShown: ShownCount,
  after: z
    .string()
    .optional()
    .transform((after) => (after === "" ? undefined : after)),
});
export type StudyNextQuery = z.input<typeof StudyNextQuery>;

/**
 * The body `GET /api/decks/:deckId/study/next` answers: the Card the Queue
 * shows next, its schedule, and why it is shown; `next` is null when the Queue
 * is empty.
 */
export const StudyNextResponse = z.object({
  next: z.object({ card: CardResponse, schedule: CardSchedule, kind: QueueKind }).nullable(),
});
export type StudyNextResponse = z.infer<typeof StudyNextResponse>;
