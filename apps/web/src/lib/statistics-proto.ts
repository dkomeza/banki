import { MODELS } from "@banki/shared";
import { useLocation } from "@tanstack/react-router";

// PROTOTYPE (BAN-53): the `Statistics` body the spec defines, generated in
// memory from a fixed PRNG, about 120 days of Reviews, as the Seed data's
// history Deck will hold them. The days run up to today, so a Slug Preview
// and a shot both show a full recent history. `?state=` swaps in another body.

export type Range = "7" | "30" | "90" | "all";
export const RANGES: readonly { value: Range; label: string; short: string }[] = [
  { value: "7", label: "7 days", short: "7d" },
  { value: "30", label: "30 days", short: "30d" },
  { value: "90", label: "90 days", short: "90d" },
  { value: "all", label: "All time", short: "All" },
];

export type Statistics = {
  range: Range;
  /** Study days, `YYYY-MM-DD`. */
  from: string;
  to: string;
  calendar: { day: string; reviews: number; ms: number }[];
  minutes: { bucket: "day" | "week"; points: { start: string; ms: number }[] };
  actualRetention: { recalled: number; total: number; desiredRetention: number };
  cards: { new: number; learning: number; learned: number };
  graderAgreement: {
    kept: number;
    higher: number;
    lower: number;
    models: { model: string; kept: number; higher: number; lower: number }[];
  };
};

export const STATISTICS_STATES = ["range-7", "range-all", "empty", "no-graded", "tooltip"] as const;

export type StatisticsSearch = { range?: Range; state?: string };

/** The page's search params: `?range=7|30|90|all`, 30 when absent or invalid, and a Variant's `?state=`. */
export function statisticsSearch(search: Record<string, unknown>): StatisticsSearch {
  const raw = search["range"];
  const range = typeof raw === "number" ? String(raw) : raw;
  const state = search["state"];
  return {
    ...(range === "7" || range === "90" || range === "all" ? { range } : {}),
    ...(typeof state === "string" ? { state } : {}),
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;
const HISTORY_DAYS = 121;
const HAIKU = MODELS[0]?.id ?? "anthropic/claude-haiku-5.5";
const LUNA = MODELS[1]?.id ?? "openai/gpt-6-luna";

/** A Model's curated name, or its ID once it has left the list. */
export const modelName = (id: string) => MODELS.find((m) => m.id === id)?.name ?? id;

const pad = (n: number) => String(n).padStart(2, "0");
export const dayOf = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
/** A Study day at local noon, so adding days never trips over DST. */
export const dateOf = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y ?? 2000, (m ?? 1) - 1, d ?? 1, 12);
};
export const addDays = (day: string, n: number) =>
  dayOf(new Date(dateOf(day).getTime() + n * DAY_MS));
/** The Monday of a Study day's week. */
export const mondayOf = (day: string) => addDays(day, -((dateOf(day).getDay() + 6) % 7));

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Day = {
  day: string;
  reviews: number;
  ms: number;
  learned: number;
  recalled: number;
  graded: { model: string; kept: number; higher: number; lower: number }[];
};

const split = (n: number, keep: number, up: number) => {
  const kept = Math.round(n * keep);
  const higher = Math.round((n - kept) * up);
  return { kept, higher, lower: n - kept - higher };
};

function history(today: string, seed: number, scale: number): Day[] {
  const rand = mulberry32(seed);
  const days: Day[] = [];
  for (let back = HISTORY_DAYS - 1; back >= 0; back--) {
    const day = addDays(today, -back);
    const weekday = dateOf(day).getDay();
    const odds = weekday === 0 || weekday === 6 ? 0.55 : 0.85;
    if (rand() > odds) continue;
    // Busier early, while the Deck's Cards were new, then a steadier review load.
    const ramp = back > 80 ? 0.7 : back > 40 ? 1.2 : 1;
    const reviews = Math.max(1, Math.round((8 + rand() * 60) * ramp * scale));
    const ms = Math.round(reviews * (5_500 + rand() * 9_000));
    const learned = Math.round(reviews * (back > 90 ? 0.2 : 0.65));
    const recalled = Math.min(learned, Math.round(learned * (0.82 + rand() * 0.12)));
    const graded = Math.round(reviews * 0.22);
    const haiku = Math.round(graded * 0.6);
    const luna = graded - haiku;
    days.push({
      day,
      reviews,
      ms,
      learned,
      recalled,
      graded: [
        { model: HAIKU, ...split(haiku, 0.88 + rand() * 0.08, 0.5) },
        { model: LUNA, ...split(luna, 0.5 + rand() * 0.15, 0.7) },
      ],
    });
  }
  return days;
}

const seedOf = (text: string) =>
  Array.from({ length: text.length }, (_, i) => text.charCodeAt(i)).reduce(
    (h, c) => Math.imul(h ^ c, 16777619),
    2166136261,
  );

export type Scope =
  | { kind: "global" }
  | { kind: "deck"; deckId: string; desiredRetention: number; cardCount: number };

const deckStages = (n: number) => {
  const fresh = Math.round(n * 0.2);
  const learning = Math.round(n * 0.15);
  return { new: fresh, learning, learned: n - fresh - learning };
};

export function statisticsOf(
  scope: Scope,
  range: Range,
  state: string | undefined,
  now = new Date(),
): Statistics {
  const today = dayOf(now);
  const empty = state === "empty";
  const all = empty
    ? []
    : scope.kind === "global"
      ? history(today, 53, 1.6)
      : history(today, seedOf(scope.deckId), 0.35);
  const firstDay = all[0]?.day ?? today;
  const from = range === "all" ? firstDay : addDays(today, -(Number(range) - 1));
  const inRange = all.filter((d) => d.day >= from);

  const calendarFrom = addDays(mondayOf(today), -52 * 7);
  const calendar = all
    .filter((d) => d.day >= calendarFrom)
    .map(({ day, reviews, ms }) => ({ day, reviews, ms }));

  const byDay = new Map(all.map((d) => [d.day, d.ms]));
  const weekly =
    range === "all" &&
    Math.round((dateOf(today).getTime() - dateOf(from).getTime()) / DAY_MS) + 1 > 90;
  const points: { start: string; ms: number }[] = [];
  if (weekly) {
    for (let week = mondayOf(from); week <= today; week = addDays(week, 7)) {
      let ms = 0;
      for (let i = 0; i < 7; i++) ms += byDay.get(addDays(week, i)) ?? 0;
      points.push({ start: week, ms });
    }
  } else {
    for (let day = from; day <= today; day = addDays(day, 1))
      points.push({ start: day, ms: byDay.get(day) ?? 0 });
  }

  const models = new Map<string, { model: string; kept: number; higher: number; lower: number }>();
  if (state !== "no-graded") {
    for (const d of inRange)
      for (const g of d.graded) {
        const m = models.get(g.model) ?? { model: g.model, kept: 0, higher: 0, lower: 0 };
        m.kept += g.kept;
        m.higher += g.higher;
        m.lower += g.lower;
        models.set(g.model, m);
      }
  }
  const sum = (key: "kept" | "higher" | "lower") =>
    [...models.values()].reduce((s, m) => s + m[key], 0);

  return {
    range,
    from,
    to: today,
    calendar,
    minutes: { bucket: weekly ? "week" : "day", points },
    actualRetention: {
      recalled: inRange.reduce((s, d) => s + d.recalled, 0),
      total: inRange.reduce((s, d) => s + d.learned, 0),
      desiredRetention: scope.kind === "deck" ? scope.desiredRetention : 88.4,
    },
    cards: empty
      ? scope.kind === "global"
        ? { new: 214, learning: 0, learned: 0 }
        : { new: scope.cardCount, learning: 0, learned: 0 }
      : scope.kind === "global"
        ? { new: 131, learning: 23, learned: 187 }
        : deckStages(scope.cardCount),
    graderAgreement: {
      kept: sum("kept"),
      higher: sum("higher"),
      lower: sum("lower"),
      models: [...models.values()].filter((m) => m.kept + m.higher + m.lower > 0),
    },
  };
}

/** The range and state the page shows: `?state=range-…` picks a range too. */
export function useStatisticsView(search: StatisticsSearch) {
  const state = useLocation({
    select: (l) => {
      const s: Record<string, unknown> = l.search;
      return typeof s["state"] === "string" ? s["state"] : undefined;
    },
  });
  const range: Range =
    state === "range-7" ? "7" : state === "range-all" ? "all" : (search.range ?? "30");
  return { range, state };
}

/** The calendar's 5 levels: none, then the quartiles of the year's non-zero days. */
export function levelsOf(calendar: Statistics["calendar"]) {
  const counts = calendar
    .map((d) => d.reviews)
    .filter((n) => n > 0)
    .toSorted((a, b) => a - b);
  const q = (p: number) => counts[Math.min(counts.length - 1, Math.floor(p * counts.length))] ?? 0;
  const cuts = [q(0.25), q(0.5), q(0.75)];
  return (reviews: number) =>
    reviews === 0
      ? 0
      : reviews <= (cuts[0] ?? 0)
        ? 1
        : reviews <= (cuts[1] ?? 0)
          ? 2
          : reviews <= (cuts[2] ?? 0)
            ? 3
            : 4;
}

/** The 53 weeks of the calendar, Monday first, each a column of 7 days; days after today are null. */
export function calendarWeeks(today: string) {
  const start = addDays(mondayOf(today), -52 * 7);
  const weeks: (string | null)[][] = [];
  for (let w = 0; w < 53; w++) {
    const week: (string | null)[] = [];
    for (let d = 0; d < 7; d++) {
      const day = addDays(start, w * 7 + d);
      week.push(day > today ? null : day);
    }
    weeks.push(week);
  }
  return weeks;
}

/** The day the `tooltip` state opens: the busiest of the last two weeks. */
export function tooltipDay(stats: Statistics) {
  const recent = stats.calendar.filter((d) => d.day >= addDays(stats.to, -13));
  return recent.reduce<Statistics["calendar"][number] | undefined>(
    (best, d) => (best === undefined || d.reviews > best.reviews ? d : best),
    undefined,
  )?.day;
}

export const minutesOf = (ms: number) => Math.round(ms / 60_000);
export const percent = (part: number, whole: number) => (whole === 0 ? 0 : (part / whole) * 100);

const LONG = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
});
const SHORT = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
const MONTH = new Intl.DateTimeFormat("en-GB", { month: "short" });
export const longDay = (day: string) => LONG.format(dateOf(day));
export const shortDay = (day: string) => SHORT.format(dateOf(day));
export const monthOf = (day: string) => MONTH.format(dateOf(day));
