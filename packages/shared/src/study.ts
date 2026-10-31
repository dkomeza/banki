import { z } from "zod";
import { CardResponse } from "./cards";
import { CardSchedule, CardState } from "./scheduling";

// Studying a Deck (CONTEXT.md: Session, Queue). The API orders the Queue; the
// study screen asks it for the next Card.

/** Why the Queue shows a Card: it is new, back from a learning step, or a due review. */
export const QUEUE_KINDS = ["new", "learning", "review"] as const;
export const QueueKind = z.enum(QUEUE_KINDS);
export type QueueKind = z.infer<typeof QueueKind>;

/** The New-card batch a User has until they change it (CONTEXT.md: New-card batch). */
export const DEFAULT_NEW_CARD_BATCH = 20;
export const NEW_CARD_BATCH_MIN = 5;
export const NEW_CARD_BATCH_MAX = 100;

/** A New-card batch: a whole number of New cards from 5 to 100. */
export const NewCardBatch = z
  .number()
  .int("Expected a whole number")
  .min(NEW_CARD_BATCH_MIN, "Expected a number from 5 to 100")
  .max(NEW_CARD_BATCH_MAX, "Expected a number from 5 to 100");

/** The Learning limit a User has until they change it (CONTEXT.md: Learning limit). */
export const DEFAULT_LEARNING_LIMIT = 10;
export const LEARNING_LIMIT_MIN = 5;
export const LEARNING_LIMIT_MAX = 50;

/** A Learning limit: a whole number of Cards from 5 to 50. */
export const LearningLimit = z
  .number()
  .int("Expected a whole number")
  .min(LEARNING_LIMIT_MIN, "Expected a number from 5 to 50")
  .max(LEARNING_LIMIT_MAX, "Expected a number from 5 to 50");

/** A count the Session keeps: a non-negative whole number, as a query string gives it; 0 when left out. */
const ShownCount = z
  .string()
  .regex(/^\d+$/, "Expected a whole number from 0")
  .transform(Number)
  .refine(Number.isSafeInteger, "Expected a whole number from 0")
  .default(0);

/** How many New-card batches the Session has been given: a whole number from 1; 1 when left out. */
const Batches = z
  .string()
  .regex(/^[1-9]\d*$/, "Expected a whole number from 1")
  .transform(Number)
  .refine(Number.isSafeInteger, "Expected a whole number from 1")
  .default(1);

/**
 * The query of `GET /api/decks/:deckId/study/next`: how many review and new
 * Cards the Session has shown (each counted the first time, by the `kind` it
 * was answered with; a learning Card coming back counts for neither), and the
 * ID of the Card just shown, if any; an empty one is none. `batches` is how
 * many New-card batches the Session has been given: 1 at its start, one more
 * each time the User takes another.
 */
export const StudyNextQuery = z.object({
  reviewsShown: ShownCount,
  newShown: ShownCount,
  batches: Batches,
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
 * preview at that moment; `next` is null when the Queue is empty. `newHeld`
 * is how many New cards the New-card batch held back when it is empty, so the
 * study screen can offer another batch; 0 otherwise.
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
  newHeld: z.number().int().nonnegative(),
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

/**
 * The body `GET /api/decks/:deckId/study/overview` answers: what Study will
 * bring now. `due` is the Deck's review Cards due before the next Day start
 * plus every Card in its learning steps; `new` the New cards a Session
 * introduces, at most a New-card batch, of `newTotal` in all; `estimateMs`
 * how long they will take, from the User's own Reviews. `nextDue` is the
 * first Study day after today with review Cards due (its calendar date, as a
 * Study day is named) and how many fall due on it; null when none ever is.
 */
export const StudyOverviewResponse = z.object({
  due: z.number().int().nonnegative(),
  new: z.number().int().nonnegative(),
  newTotal: z.number().int().nonnegative(),
  estimateMs: z.number().int().nonnegative(),
  nextDue: z
    .object({
      day: z.iso.date(),
      count: z.number().int().positive(),
    })
    .nullable(),
});
export type StudyOverviewResponse = z.infer<typeof StudyOverviewResponse>;
