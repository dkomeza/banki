import { z } from "zod";
import { CardResponse } from "./cards";
import { CardSchedule, CardState } from "./scheduling";

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
 * What one Rating of a Card would give at a moment (CONTEXT.md: Interval): the
 * state it leaves the Card in, the Study days it puts it off (0 in learning
 * steps), and when it would be due, ISO 8601. It is exactly what the Rating
 * gives at that moment.
 */
export const IntervalPreview = z.object({
  state: CardState,
  scheduledDays: z.number().int().nonnegative(),
  due: z.iso.datetime(),
});
export type IntervalPreview = z.infer<typeof IntervalPreview>;

/** Each Rating's Interval preview for a Card. */
export const IntervalPreviews = z.object({
  again: IntervalPreview,
  hard: IntervalPreview,
  good: IntervalPreview,
  easy: IntervalPreview,
});
export type IntervalPreviews = z.infer<typeof IntervalPreviews>;

/**
 * The body `GET /api/decks/:deckId/study/next` answers: the Card the Queue
 * shows next, its schedule, why it is shown, and each Rating's Interval
 * preview at that moment; `next` is null when the Queue is empty.
 */
export const StudyNextResponse = z.object({
  next: z
    .object({
      card: CardResponse,
      schedule: CardSchedule,
      kind: QueueKind,
      intervals: IntervalPreviews,
    })
    .nullable(),
});
export type StudyNextResponse = z.infer<typeof StudyNextResponse>;

/**
 * The body `DELETE /api/reviews/:id` answers (an Undo): the Card the Review
 * was of, its schedule as it was before the Review, and each Rating's
 * Interval preview from there, so the study screen can show it again.
 */
export const UndoReviewResponse = z.object({
  card: CardResponse,
  schedule: CardSchedule,
  intervals: IntervalPreviews,
});
export type UndoReviewResponse = z.infer<typeof UndoReviewResponse>;
