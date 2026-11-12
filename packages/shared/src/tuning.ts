import { z } from "zod";
import { DesiredRetention } from "./scheduling";

// Tuning (CONTEXT.md): fitting the Parameters FSRS schedules with to the
// User's own Reviews. The API tunes; both apps use these.

/** How many Reviews past the newest Tuning log row's count start an automatic Tuning. */
export const TUNING_REVIEW_INTERVAL = 200;

/**
 * How many Reviews a live Deck needs, counted as Review rows by the Deck they
 * now carry, before a Tuning fits it Parameters of its own (ADR-0033).
 */
export const DECK_TUNING_MIN_REVIEWS = 1000;

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
 * whether a Tuning is running; the Recommended retention, a whole percent
 * from 70 to 97, the newest Tuning log row's, null while the defaults are in
 * use or when there is none; and how many of the User's Decks, deleted ones
 * too, have Parameters of their own (ADR-0033). It all describes the overall
 * Parameters: only the overall rows, with no Deck, count. Times are ISO 8601.
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
  ownDecks: z.number().int().nonnegative(),
});
export type TuningStatus = z.infer<typeof TuningStatus>;

/** The body `POST /api/tuning` (Tune now) answers: the Tuning's result, and how Tuning then stands. */
export const TuneResponse = z.object({ result: TuningResult, status: TuningStatus });
export type TuneResponse = z.infer<typeof TuneResponse>;

/**
 * How Tuning stands for one live Deck, as `GET /api/decks/:deckId/tuning`
 * answers it (ADR-0033): whether it uses Parameters of its `own` or the
 * `overall` ones; when its own were applied, and from how many of its
 * Reviews (null while it has none, or none were logged); its Review count and
 * the threshold it is tuned from; its newest Tuning log row (null before any);
 * and its Recommended retention: its own while it has its own Parameters,
 * otherwise the overall one, null where there is none. Times are ISO 8601.
 */
export const DeckTuningStatus = z.object({
  parameters: z.enum(["own", "overall"]),
  tuned: z.object({ at: z.iso.datetime(), reviews: z.number().int().nonnegative() }).nullable(),
  reviewCount: z.number().int().nonnegative(),
  threshold: z.number().int().positive(),
  lastAttempt: z
    .object({ at: z.iso.datetime(), trigger: TuningTrigger, outcome: TuningOutcome })
    .nullable(),
  recommendedRetention: DesiredRetention.nullable(),
});
export type DeckTuningStatus = z.infer<typeof DeckTuningStatus>;
