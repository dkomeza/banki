import { z } from "zod";
import { type StudyDay, addStudyDays } from "./study-day";

// A Deck's Plan (CONTEXT.md: Plan, Deadline, Daily goal; ADR-0031): a Deadline
// to work toward and a Daily goal in minutes, and the feasibility check that
// says whether the goal covers the Deck's New cards by the Deadline. The API
// keeps and checks Plans; both apps use these.

/** The fewest minutes a Daily goal takes. */
export const DAILY_MINUTES_MIN = 5;
/** The most minutes a Daily goal takes. */
export const DAILY_MINUTES_MAX = 600;
/** How many years after today a Deadline may be. */
export const DEADLINE_MAX_YEARS = 2;
/** The steps `neededMinutes` comes in. */
export const NEEDED_MINUTES_STEP = 5;

/** A Study day as the API takes and answers it: `YYYY-MM-DD`, a real calendar date. */
export const Deadline = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a date, YYYY-MM-DD")
  .refine((day) => {
    const date = new Date(`${day}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === day;
  }, "Expected a date, YYYY-MM-DD");

/** A Daily goal: whole minutes from 5 to 600. */
export const DailyMinutes = z
  .number()
  .int("Expected a whole number")
  .min(DAILY_MINUTES_MIN, "Expected a number from 5 to 600")
  .max(DAILY_MINUTES_MAX, "Expected a number from 5 to 600");

/** The last Deadline a Plan takes from `today`: the same date 2 years on. */
export function lastDeadline(today: StudyDay): StudyDay {
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCFullYear(date.getUTCFullYear() + DEADLINE_MAX_YEARS);
  return date.toISOString().slice(0, 10);
}

/**
 * What's wrong with a Deadline when today is the Study day `today`: `too_soon`
 * when it isn't after today, `too_far` when it is more than 2 years out;
 * undefined when it is fine.
 */
export function deadlineProblem(
  deadline: StudyDay,
  today: StudyDay,
): "too_soon" | "too_far" | undefined {
  if (deadline < addStudyDays(today, 1)) return "too_soon";
  if (deadline > lastDeadline(today)) return "too_far";
  return undefined;
}

/** A Plan as the API answers it: its Deadline, a Study day, and its Daily goal. */
export const PlanResponse = z.object({ deadline: Deadline, dailyMinutes: DailyMinutes });
export type PlanResponse = z.infer<typeof PlanResponse>;

/**
 * The body of `PUT /api/decks/:deckId/plan`, which creates or replaces the
 * Deck's Plan. The Deadline must also be after today and within 2 years, by
 * the User's Study days, which the API checks.
 */
export const PutPlanRequest = z.strictObject({ deadline: Deadline, dailyMinutes: DailyMinutes });
export type PutPlanRequest = z.input<typeof PutPlanRequest>;

/**
 * The query of `GET /api/decks/:deckId/plan/check`: the Plan to check, as a
 * query string gives it.
 */
export const PlanCheckQuery = z.object({
  deadline: Deadline,
  dailyMinutes: z
    .string()
    .regex(/^\d+$/, "Expected a whole number")
    .transform(Number)
    .pipe(DailyMinutes),
});
export type PlanCheckQuery = z.input<typeof PlanCheckQuery>;

/**
 * What the feasibility check answers: the Deck's live New cards, those never
 * introduced before the Deadline at the Daily goal (`unlearned`), and the
 * smallest goal, a multiple of 5 up to 600, at which none is left; null when
 * even 600 leaves some.
 */
export const PlanCheckResponse = z.object({
  newCards: z.number().int().nonnegative(),
  unlearned: z.number().int().nonnegative(),
  neededMinutes: z.number().int().positive().nullable(),
});
export type PlanCheckResponse = z.infer<typeof PlanCheckResponse>;
