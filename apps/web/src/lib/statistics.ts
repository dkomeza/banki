import {
  CALENDAR_WEEKS,
  DEFAULT_STATISTICS_RANGE,
  MODELS,
  Statistics,
  type StatisticsRange,
  type StudyDay,
  addStudyDays,
  calendarStartOf,
  statisticsRangeOf,
  studyDaysBetween,
} from "@banki/shared";
import { queryOptions } from "@tanstack/react-query";
import { type ApiClient, api } from "./api";
import { ApiRequestError } from "./query";

// The Statistics pages (BAN-53): their range, their data from the API, and
// how the charts word and shade what it holds. Study days are dates, named
// `YYYY-MM-DD`, and shown as such, whatever the browser's zone.

export type { Statistics };

/** The ranges, in the picker's order, with their labels. */
export const RANGES: readonly { value: StatisticsRange; label: string }[] = [
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "all", label: "All time" },
];

/**
 * The pages' search params: `?range=7|90|all`, left out for the default, 30
 * days. A number of days is kept as a number, which the router writes as
 * `7`; as a string it would be quoted, `"7"`.
 */
export type StatisticsSearch = { range?: (typeof IN_SEARCH)[StatisticsRange] };

const IN_SEARCH = { "7": 7, "30": 30, "90": 90, all: "all" } as const;

/** The search params for `range`: the default is left out of the URL. */
export const searchFor = (range: StatisticsRange): StatisticsSearch =>
  range === DEFAULT_STATISTICS_RANGE ? {} : { range: IN_SEARCH[range] };

/** Reads the search params, a missing or unknown range as the default. */
export const statisticsSearch = (search: Record<string, unknown>): StatisticsSearch =>
  searchFor(statisticsRangeOf(search["range"]));

/** The range the search params pick. */
export const rangeOf = (search: StatisticsSearch): StatisticsRange =>
  statisticsRangeOf(search.range);

const parsed = async (res: Response) => {
  if (!res.ok) throw new ApiRequestError(res.status);
  return Statistics.parse(await res.json());
};

/** Every Deck's statistics over `range`, from `GET /api/statistics`. */
export const statisticsQueryOptions = (range: StatisticsRange, client: ApiClient = api) =>
  queryOptions({
    queryKey: ["statistics", range],
    queryFn: async (): Promise<Statistics> =>
      parsed(await client.api.statistics.$get({ query: { range } })),
  });

/**
 * The Deck `deckId`'s statistics over `range`, from
 * `GET /api/decks/:deckId/statistics`; null for a Deck that is gone. They sit
 * under the Deck's key, so whatever fetches the Decks again fetches them too.
 */
export const deckStatisticsQueryOptions = (
  deckId: string,
  range: StatisticsRange,
  client: ApiClient = api,
) =>
  queryOptions({
    queryKey: ["decks", deckId, "statistics", range],
    queryFn: async (): Promise<Statistics | null> => {
      const res = await client.api.decks[":deckId"].statistics.$get({
        param: { deckId },
        query: { range },
      });
      const status: number = res.status;
      if (status === 404) return null;
      return parsed(res);
    },
  });

/** A Model's curated name, or its ID once it has left the list. */
export const modelName = (id: string) => MODELS.find((model) => model.id === id)?.name ?? id;

const asDate = (day: StudyDay) => new Date(`${day}T12:00:00Z`);
const LONG = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
});
const SHORT = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short" });
const MONTH = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", month: "short" });

/** A Study day in full: "Tue, 13 Oct 2026". */
export const longDay = (day: StudyDay) => LONG.format(asDate(day));
/** A Study day short: "13 Oct". */
export const shortDay = (day: StudyDay) => SHORT.format(asDate(day));
/** A Study day's month: "Oct". */
export const monthOf = (day: StudyDay) => MONTH.format(asDate(day));
/** A Study day's date in its month, from 1. */
export const dateOf = (day: StudyDay) => asDate(day).getUTCDate();

/** "1 review", "5,648 reviews". */
export const reviewsLabel = (n: number) =>
  `${n.toLocaleString("en-GB")} ${n === 1 ? "review" : "reviews"}`;

/** Milliseconds as whole minutes: "7 min", "3 h 29 min". */
export function minutesLabel(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

/** A percentage with `digits` decimals: "89.1%". */
export const percentLabel = (value: number, digits = 1) =>
  `${value.toLocaleString("en-GB", { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;

/** The range in words, after "over": "the last 30 days", or "since 29 Jun" for All time. */
export const rangeLabel = ({ range, from }: Pick<Statistics, "range" | "from">) =>
  range === "all" ? `since ${shortDay(from)}` : `the last ${range} days`;

/** "over the last 30 days", or "since 29 Jun". */
export const overRangeLabel = (stats: Pick<Statistics, "range" | "from">) =>
  stats.range === "all" ? rangeLabel(stats) : `over ${rangeLabel(stats)}`;

/** Minutes per day's total, and its average over the range's Study days. */
export function minutesSummary(stats: Statistics) {
  const total = stats.minutes.points.reduce((sum, point) => sum + point.ms, 0);
  return { total, perDay: total / studyDaysBetween(stats.from, stats.to) };
}

/** The calendar's level of a Study day with `reviews`: 0 for none, then 1 to 4. */
export type Level = 0 | 1 | 2 | 3 | 4;

/**
 * The activity calendar's 5 levels: none, then the quartiles of the year's
 * non-zero days, a day at a quartile counted in the level below it.
 */
export function levelsOf(calendar: Statistics["calendar"]): (reviews: number) => Level {
  const counts = calendar
    .map((day) => day.reviews)
    .filter((n) => n > 0)
    .toSorted((a, b) => a - b);
  const quartile = (p: number) =>
    counts[Math.min(counts.length - 1, Math.ceil(p * counts.length) - 1)] ?? 0;
  const cuts = [quartile(0.25), quartile(0.5), quartile(0.75)];
  return (reviews) => {
    if (reviews <= 0) return 0;
    if (reviews <= (cuts[0] ?? 0)) return 1;
    if (reviews <= (cuts[1] ?? 0)) return 2;
    if (reviews <= (cuts[2] ?? 0)) return 3;
    return 4;
  };
}

/**
 * The calendar's 53 weeks to the one `today` is in, Monday first, each a
 * column of 7 Study days; the days after today are null.
 */
export function calendarWeeks(today: StudyDay): (StudyDay | null)[][] {
  const start = calendarStartOf(today);
  return Array.from({ length: CALENDAR_WEEKS }, (_, week) =>
    Array.from({ length: 7 }, (_day, weekday) => {
      const day = addStudyDays(start, week * 7 + weekday);
      return day > today ? null : day;
    }),
  );
}
