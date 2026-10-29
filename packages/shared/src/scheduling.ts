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

/** How a Review got its Rating: rated by the User, or the Grader's suggestion confirmed (M6). */
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

/** The body of `POST /api/cards/:id/reviews`: the Rating, and the time spent on the Card in ms. */
export const ReviewRequest = z.strictObject({
  rating: Rating,
  durationMs: z.number().int("Expected whole milliseconds").nonnegative(),
});
export type ReviewRequest = z.input<typeof ReviewRequest>;

/** A Review as the API answers it. `reviewedAt` is an ISO 8601 time. */
export const ReviewResponse = z.object({
  id: z.string(),
  cardId: z.string(),
  deckId: z.string(),
  reviewedAt: z.iso.datetime(),
  rating: Rating,
  kind: ReviewKind,
  durationMs: z.number().int().nonnegative(),
});
export type ReviewResponse = z.infer<typeof ReviewResponse>;

/** The body `POST /api/cards/:id/reviews` answers: the Review it recorded, and the Card's new schedule. */
export const RateCardResponse = z.object({ review: ReviewResponse, schedule: CardSchedule });
export type RateCardResponse = z.infer<typeof RateCardResponse>;
