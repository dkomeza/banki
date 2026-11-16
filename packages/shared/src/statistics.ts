import { z } from "zod";
import { Deadline } from "./plans";
import { type StudyDay, addStudyDays } from "./study-day";

// Statistics (BAN-53): what the User's Reviews add up to, over every Deck or
// one Deck's, across a range of Study days (CONTEXT.md: Actual retention,
// Learned card). The API works them out on each request; both apps use these.

/** The ranges statistics take: 7, 30 or 90 Study days up to today, or All time. */
export const STATISTICS_RANGES = ["7", "30", "90", "all"] as const;
export const StatisticsRange = z.enum(STATISTICS_RANGES);
export type StatisticsRange = z.infer<typeof StatisticsRange>;

/** The range statistics show when none is asked for. */
export const DEFAULT_STATISTICS_RANGE: StatisticsRange = "30";

/** How many weeks the activity calendar covers, up to and including the current one. */
export const CALENDAR_WEEKS = 53;

/** Past this many Study days, All time's Minutes per day are counted per week. */
export const DAILY_MINUTES_DAYS_MAX = 90;

/** A range as a URL gives it, or the default when it is missing or not one of the ranges. */
export function statisticsRangeOf(value: unknown): StatisticsRange {
  const parsed = StatisticsRange.safeParse(typeof value === "number" ? String(value) : value);
  return parsed.success ? parsed.data : DEFAULT_STATISTICS_RANGE;
}

/**
 * The query of `GET /api/statistics` and `GET /api/decks/:deckId/statistics`:
 * the range, 30 days when left out.
 */
export const StatisticsQuery = z.object({
  range: StatisticsRange.default(DEFAULT_STATISTICS_RANGE),
});
export type StatisticsQuery = z.input<typeof StatisticsQuery>;

const toDate = (day: StudyDay) => new Date(`${day}T00:00:00Z`);

/** The Monday of the week a Study day is in: weeks start on Monday. */
export const mondayOf = (day: StudyDay): StudyDay =>
  addStudyDays(day, -((toDate(day).getUTCDay() + 6) % 7));

/** How many Study days run from `from` to `to`, both counted. */
export const studyDaysBetween = (from: StudyDay, to: StudyDay): number =>
  Math.round((toDate(to).getTime() - toDate(from).getTime()) / 86_400_000) + 1;

/** The first Study day of the activity calendar when today is `today`: a Monday, 52 weeks before this one's. */
export const calendarStartOf = (today: StudyDay): StudyDay =>
  addStudyDays(mondayOf(today), -(CALENDAR_WEEKS - 1) * 7);

/** A Study day as the API answers it, `YYYY-MM-DD`, the way a Deadline is. */
const Day = Deadline;
const Count = z.number().int().nonnegative();
const Ms = z.number().int().nonnegative();

/** Kept, rated higher and rated lower: how graded Reviews' Ratings stood to the suggested one. */
const Agreement = z.object({ kept: Count, higher: Count, lower: Count });

/**
 * The statistics `GET /api/statistics` (every Deck) and
 * `GET /api/decks/:deckId/statistics` (one Deck) answer:
 *
 * - `from` and `to`: the range's first Study day and today. All time starts
 *   on the first Study day with a counted Review, or today with none.
 * - `calendar`: the Study days of the last 53 weeks that have Reviews, with
 *   their count and summed `durationMs`, whatever the range.
 * - `minutes`: the summed `durationMs` over the range, a point a Study day
 *   (zeros included), or a week, from its Monday, for All time spanning more
 *   than 90 days.
 * - `actualRetention`: of the range's Reviews of Learned cards, those not
 *   rated Again, and the Desired retention, in percent, they compare with.
 * - `cards`: live Cards now, by stage, whatever the range.
 * - `graderAgreement`: the range's graded Reviews whose Rating was the
 *   suggested one, higher or lower, overall and per Model ID.
 */
export const Statistics = z.object({
  range: StatisticsRange,
  from: Day,
  to: Day,
  calendar: z.array(z.object({ day: Day, reviews: Count, ms: Ms })),
  minutes: z.object({
    bucket: z.enum(["day", "week"]),
    points: z.array(z.object({ start: Day, ms: Ms })),
  }),
  actualRetention: z.object({
    recalled: Count,
    total: Count,
    desiredRetention: z.number().min(0).max(100),
  }),
  cards: z.object({ new: Count, learning: Count, learned: Count }),
  graderAgreement: Agreement.extend({
    models: z.array(Agreement.extend({ model: z.string() })),
  }),
});
export type Statistics = z.infer<typeof Statistics>;
