// PROTOTYPE (BAN-57): a stand-in for the Plan API and its feasibility check,
// so the Plan card's states can be tried on a Slug Preview. The check is a
// made-up curve through the spec's example (300 new cards; 35 min a day covers
// them by 12 Dec), not the day-by-day simulation the implement Stage builds.

/** A Study day, `YYYY-MM-DD`. */
export type Day = string;

export type Plan = { deadline: Day; dailyMinutes: number };

export type Check =
  | { kind: "covers"; newCards: number }
  | { kind: "warning"; newCards: number; unlearned: number; neededMinutes: number }
  | { kind: "impossible"; newCards: number; unlearned: number }
  | { kind: "none" };

export const MIN_MINUTES = 5;
export const MAX_MINUTES = 600;
export const NEW_PLAN_MINUTES = 30;

/** The spec's example Deadline. */
export const EXAMPLE_DEADLINE: Day = "2026-12-12";
const NEW_CARDS = 300;

const dateOf = (day: Day) => new Date(`${day}T00:00:00Z`);
const dayOf = (date: Date): Day => date.toISOString().slice(0, 10);

/** Today's Study day, near enough for a prototype: the browser's own date. */
export function today(): Day {
  const now = new Date();
  return dayOf(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())));
}

export const addDays = (day: Day, days: number): Day =>
  dayOf(new Date(dateOf(day).getTime() + days * 86_400_000));

export const daysBetween = (from: Day, to: Day) =>
  Math.round((dateOf(to).getTime() - dateOf(from).getTime()) / 86_400_000);

/** The last Deadline a Plan takes: 2 years after today. */
export const lastDeadline = (from: Day = today()) => {
  const date = dateOf(from);
  date.setUTCFullYear(date.getUTCFullYear() + 2);
  return dayOf(date);
};

/** "12 Dec". */
export const shortDate = (day: Day) =>
  dateOf(day).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** "Saturday 12 December 2026". */
export const longDate = (day: Day) =>
  dateOf(day).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

/** "in 33 days", "tomorrow", "today", "3 days ago". */
export function relativeDays(day: Day, from: Day = today()) {
  const days = daysBetween(from, day);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}

export function deadlineProblem(deadline: Day | undefined): string | undefined {
  if (deadline === undefined) return undefined;
  if (daysBetween(today(), deadline) < 1) return "Pick a day after today.";
  if (deadline > lastDeadline()) return "Pick a day within 2 years.";
  return undefined;
}

export function minutesProblem(minutes: number | undefined): string | undefined {
  if (minutes === undefined || Number.isNaN(minutes)) return "Enter the minutes a day.";
  if (!Number.isInteger(minutes) || minutes < MIN_MINUTES || minutes > MAX_MINUTES)
    return `Between ${MIN_MINUTES} and ${MAX_MINUTES} minutes.`;
  return undefined;
}

/** What `GET …/plan/check` would answer, made up. */
export function check(plan: Plan): Check {
  const days = Math.max(1, daysBetween(today(), plan.deadline));
  const exampleDays = Math.max(1, daysBetween(today(), EXAMPLE_DEADLINE));
  const exact = (35 * exampleDays) / days;
  const needed = Math.ceil(exact / 5) * 5;
  if (needed <= plan.dailyMinutes) return { kind: "covers", newCards: NEW_CARDS };
  // The spec's example, word for word: 20 min by 12 Dec leaves ~140.
  const unlearned =
    plan.deadline === EXAMPLE_DEADLINE && plan.dailyMinutes === 20
      ? 140
      : Math.max(1, Math.round(NEW_CARDS * (1 - plan.dailyMinutes / exact) ** 0.85));
  if (needed > MAX_MINUTES) return { kind: "impossible", newCards: NEW_CARDS, unlearned };
  return { kind: "warning", newCards: NEW_CARDS, unlearned, neededMinutes: needed };
}

/** The Plan card's states, as the Prototype section names them. */
export const PLAN_STATES = [
  "creating",
  "covers",
  "warning",
  "impossible",
  "invalid",
  "plan",
  "plan-warning",
  "past",
  "remove",
  "empty",
] as const;

/** Where a `?state=` starts the card: its saved Plan, and the form's fields when open. */
export type Start = {
  saved: Plan | null;
  form?: { deadline: Day | undefined; minutes: string };
  removing?: boolean;
  /** The Deck has no New cards. */
  empty?: boolean;
};

export function startOf(state: string | undefined): Start {
  switch (state) {
    case "creating":
      return { saved: null, form: { deadline: undefined, minutes: String(NEW_PLAN_MINUTES) } };
    case "covers":
      return { saved: null, form: { deadline: EXAMPLE_DEADLINE, minutes: "40" } };
    case "warning":
      return { saved: null, form: { deadline: EXAMPLE_DEADLINE, minutes: "20" } };
    case "impossible":
      return { saved: null, form: { deadline: addDays(today(), 1), minutes: "30" } };
    case "invalid":
      return { saved: null, form: { deadline: addDays(today(), -7), minutes: "700" } };
    case "plan":
      return { saved: { deadline: EXAMPLE_DEADLINE, dailyMinutes: 40 } };
    case "plan-warning":
      return { saved: { deadline: EXAMPLE_DEADLINE, dailyMinutes: 20 } };
    case "past":
      return { saved: { deadline: addDays(today(), -3), dailyMinutes: 30 } };
    case "remove":
      return { saved: { deadline: EXAMPLE_DEADLINE, dailyMinutes: 40 }, removing: true };
    case "empty":
      return { saved: null, form: { deadline: EXAMPLE_DEADLINE, minutes: "30" }, empty: true };
    default:
      return { saved: null };
  }
}

/** The check's sentence, as the spec words it. */
export function checkText(result: Check, plan: Plan): string {
  const by = shortDate(plan.deadline);
  switch (result.kind) {
    case "covers":
      return `Covers all ${result.newCards} new cards by ${by}.`;
    case "warning":
      return `At ${plan.dailyMinutes} min a day, ~${result.unlearned} of ${result.newCards} new cards won't be learned by ${by}. ${result.neededMinutes} min a day would cover them.`;
    case "impossible":
      return `Even 600 min a day leaves ~${result.unlearned} of ${result.newCards} new cards unlearned by ${by}. A later deadline would give them time.`;
    default:
      return "No new cards to learn.";
  }
}

/** A day's year and month, the month from 0. */
export const monthOf = (day: Day) => ({
  year: Number(day.slice(0, 4)),
  month: Number(day.slice(5, 7)) - 1,
});

/** The month grid's weeks, Monday first, `null` outside the month. */
export function monthWeeks(year: number, month: number): (Day | null)[][] {
  const first = new Date(Date.UTC(year, month, 1));
  const lead = (first.getUTCDay() + 6) % 7;
  const length = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells: (Day | null)[] = Array.from({ length: lead }, () => null);
  for (let date = 1; date <= length; date++)
    cells.push(dayOf(new Date(Date.UTC(year, month, date))));
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (Day | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

export const monthName = (year: number, month: number) =>
  new Date(Date.UTC(year, month, 1)).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
