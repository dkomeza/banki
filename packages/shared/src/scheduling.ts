import { z } from "zod";

// Scheduling (CONTEXT.md): Ratings, Reviews, when a Card is Due, and the
// Desired retention FSRS schedules for. The API schedules; both apps use these.

/** The Desired retention a User has until they change it: 90%. */
export const DEFAULT_DESIRED_RETENTION = 90;
export const DESIRED_RETENTION_MIN = 70;
export const DESIRED_RETENTION_MAX = 97;

/** A Desired retention: a whole percent from 70 to 97. */
export const DesiredRetention = z
  .number()
  .int("Expected a whole percent")
  .min(DESIRED_RETENTION_MIN, "Expected a percent from 70 to 97")
  .max(DESIRED_RETENTION_MAX, "Expected a percent from 70 to 97");

/** How well the User recalled a Card, from worst to best. */
export const RATINGS = ["again", "hard", "good", "easy"] as const;
export const Rating = z.enum(RATINGS);
export type Rating = z.infer<typeof Rating>;

/**
 * How a Review got its Rating: `graded` when the User rated with the Grader's
 * suggested Rating on screen, whichever Rating they gave, and `self-rated`
 * otherwise (CONTEXT.md: Review).
 */
export const REVIEW_KINDS = ["self-rated", "graded"] as const;
export const ReviewKind = z.enum(REVIEW_KINDS);
export type ReviewKind = z.infer<typeof ReviewKind>;

/**
 * Where a Card is in FSRS: `new` until its first Review, `learning` and
 * `relearning` while in their learning steps (due at an exact moment), and
 * `review` once past them (due on a Study day).
 */
export const CARD_STATES = ["new", "learning", "review", "relearning"] as const;
export const CardState = z.enum(CARD_STATES);
export type CardState = z.infer<typeof CardState>;

/**
 * A Card's schedule as the API answers it: its state, when it is due (null
 * while new), its memory state (stability in days, difficulty from 1 to 10),
 * how many Reviews and lapses it has had, the days its last Review scheduled
 * it out (0 in learning steps), and when that Review was. Times are ISO 8601.
 */
export const CardSchedule = z.object({
  state: CardState,
  due: z.iso.datetime().nullable(),
  stability: z.number(),
  difficulty: z.number(),
  reps: z.number().int().nonnegative(),
  lapses: z.number().int().nonnegative(),
  scheduledDays: z.number().int().nonnegative(),
  lastReview: z.iso.datetime().nullable(),
});
export type CardSchedule = z.infer<typeof CardSchedule>;

/** The most time one Review records: 2 minutes (CONTEXT.md: Review). */
export const REVIEW_CAP_MS = 2 * 60_000;

/** The longest Model ID a graded Review keeps. */
export const REVIEW_MODEL_MAX_LENGTH = 200;

/**
 * The body of `POST /api/cards/:id/reviews`: the Rating, and the time spent
 * studying the Card in ms (time spent editing it is left out). A time above
 * `REVIEW_CAP_MS` is taken as the cap, since an old tab may send more.
 *
 * A Rating given with the Grader's suggestion on screen also carries the
 * `suggestedRating` and the `model` that suggested it (any Model ID, up to
 * 200 characters), which make the Review graded: both or neither (ADR-0028).
 */
export const ReviewRequest = z
  .strictObject({
    rating: Rating,
    durationMs: z
      .number()
      .int("Expected whole milliseconds")
      .nonnegative()
      .transform((ms) => Math.min(ms, REVIEW_CAP_MS)),
    suggestedRating: Rating.optional(),
    model: z.string().min(1).max(REVIEW_MODEL_MAX_LENGTH).optional(),
  })
  .refine(
    ({ suggestedRating, model }) => (suggestedRating === undefined) === (model === undefined),
    "Expected suggestedRating and model together",
  );
export type ReviewRequest = z.input<typeof ReviewRequest>;

/**
 * A Review as the API answers it. `reviewedAt` is an ISO 8601 time; a graded
 * one has the suggested Rating and the Model that suggested it, a self-rated
 * one neither.
 */
export const ReviewResponse = z.object({
  id: z.string(),
  cardId: z.string(),
  deckId: z.string(),
  reviewedAt: z.iso.datetime(),
  rating: Rating,
  kind: ReviewKind,
  suggestedRating: Rating.nullable(),
  model: z.string().nullable(),
  durationMs: z.number().int().nonnegative(),
});
export type ReviewResponse = z.infer<typeof ReviewResponse>;

/** The body `POST /api/cards/:id/reviews` answers: the Review it recorded, and the Card's new schedule. */
export const RateCardResponse = z.object({ review: ReviewResponse, schedule: CardSchedule });
export type RateCardResponse = z.infer<typeof RateCardResponse>;

/**
 * One entry of a Card's history (CONTEXT.md: Review): a Review, with
 * `ReviewResponse`'s fields, or a Progress reset, with its moment. Times are
 * ISO 8601.
 */
export const CardHistoryEntry = z.discriminatedUnion("type", [
  ReviewResponse.extend({ type: z.literal("review") }),
  z.object({ type: z.literal("progress-reset"), id: z.string(), resetAt: z.iso.datetime() }),
]);
export type CardHistoryEntry = z.infer<typeof CardHistoryEntry>;

/**
 * The body `GET /api/cards/:id/history` answers: every Review and Progress
 * reset of the Card, newest first in the Write order (ADR-0026).
 */
export const CardHistoryResponse = z.object({ entries: z.array(CardHistoryEntry) });
export type CardHistoryResponse = z.infer<typeof CardHistoryResponse>;
