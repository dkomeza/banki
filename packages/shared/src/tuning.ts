import { z } from "zod";
import { DesiredRetention } from "./scheduling";

// Tuning (CONTEXT.md): fitting the Parameters FSRS schedules with to the
// User's own Reviews. The API tunes; both apps use these.

/** How many Reviews past the newest Tuning log row's count start an automatic Tuning. */
export const TUNING_REVIEW_INTERVAL = 200;

/** What started a Tuning log row: a Rating (automatic), Tune now (manual), or Reset to defaults. */
export const TUNING_TRIGGERS = ["automatic", "manual", "reset"] as const;
export const TuningTrigger = z.enum(TUNING_TRIGGERS);
export type TuningTrigger = z.infer<typeof TuningTrigger>;

/** How a Tuning ended, as Tune now answers it. */
export const TUNING_RESULTS = ["applied", "kept", "not_enough_data", "failed"] as const;
export const TuningResult = z.enum(TUNING_RESULTS);
export type TuningResult = z.infer<typeof TuningResult>;

/**
 * How a Tuning log row ended: a Tuning's result, or `reset` for a Reset to
 * defaults.
 */
export const TUNING_OUTCOMES = [...TUNING_RESULTS, "reset"] as const;
export const TuningOutcome = z.enum(TUNING_OUTCOMES);
export type TuningOutcome = z.infer<typeof TuningOutcome>;

/**
 * How Tuning stands, as `GET /api/tuning` answers it: whether the Parameters
 * are FSRS's defaults or tuned; when the tuned ones were applied, and from how
 * many Reviews (null while the defaults are in use); the newest Tuning log row
 * (null before any); the Reviews left until the next automatic Tuning; whether
 * automatic Tuning is paused, after a Reset to defaults until Tune now;
 * whether a Tuning is running; and the Recommended retention, a whole percent
 * from 70 to 97, the newest Tuning log row's, null while the defaults are in
 * use or when there is none. Times are ISO 8601.
 */
export const TuningStatus = z.object({
  parameters: z.enum(["default", "tuned"]),
  tuned: z.object({ at: z.iso.datetime(), reviews: z.number().int().nonnegative() }).nullable(),
  lastAttempt: z
    .object({ at: z.iso.datetime(), trigger: TuningTrigger, outcome: TuningOutcome })
    .nullable(),
  reviewsUntilAutomatic: z.number().int().nonnegative(),
  paused: z.boolean(),
  running: z.boolean(),
  recommendedRetention: DesiredRetention.nullable(),
});
export type TuningStatus = z.infer<typeof TuningStatus>;

/** The body `POST /api/tuning` (Tune now) answers: the Tuning's result, and how Tuning then stands. */
export const TuneResponse = z.object({ result: TuningResult, status: TuningStatus });
export type TuneResponse = z.infer<typeof TuneResponse>;
