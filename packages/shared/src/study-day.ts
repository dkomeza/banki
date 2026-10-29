// Study days (CONTEXT.md): a Study day runs from one Day start to the next in
// the User's Timezone, and is derived from timestamps whenever it is read,
// never stored (ADR-0010). Both apps use these.

/** What a Study day depends on: the User's Timezone (UTC until one is stored) and Day start. */
export type StudyDaySettings = { timezone: string | null; dayStartHour: number };

/** A Study day, named by the calendar date it starts on: `"2026-05-12"`. */
export type StudyDay = string;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timezone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timezone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    formatters.set(timezone, formatter);
  }
  return formatter;
}

/**
 * The wall-clock time in `timezone` at the instant `ms`, written as if it were
 * a UTC instant (so wall-clock times compare and subtract as numbers).
 */
function wallClock(ms: number, timezone: string): number {
  const parts = formatterFor(timezone).formatToParts(ms);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((candidate) => candidate.type === type)?.value ?? 0);
  const wall = Date.UTC(
    part("year"),
    part("month") - 1,
    part("day"),
    part("hour"),
    part("minute"),
    part("second"),
  );
  // Intl drops the milliseconds; keep them.
  return wall + (((ms % 1000) + 1000) % 1000);
}

/** The UTC offset of `timezone` at the instant `ms`, in milliseconds. */
const offsetAt = (ms: number, timezone: string) => wallClock(ms, timezone) - ms;

/**
 * The first instant whose wall-clock time in `timezone` reaches `wall`: when
 * that time happens twice (a fall-back), its first occurrence; when a DST jump
 * skips it, the first moment after the gap.
 */
function firstInstantAt(wall: number, timezone: string): number {
  const before = offsetAt(wall - DAY_MS, timezone);
  const after = offsetAt(wall + DAY_MS, timezone);
  const matches = [wall - before, wall - after].filter((ms) => wallClock(ms, timezone) === wall);
  if (matches.length > 0) return Math.min(...matches);

  // Skipped: the gap's transition lies between the two candidates. Find the
  // first instant whose wall clock is past `wall`.
  let lo = Math.min(wall - before, wall - after);
  let hi = Math.max(wall - before, wall - after);
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (wallClock(mid, timezone) >= wall) hi = mid;
    else lo = mid;
  }
  return hi;
}

const toWall = (day: StudyDay) => {
  const [year = 0, month = 1, date = 1] = day.split("-").map(Number);
  return Date.UTC(year, month - 1, date);
};

const fromWall = (wall: number): StudyDay => new Date(wall).toISOString().slice(0, 10);

/** The Study day `days` after `day` (before it, when negative). */
export const addStudyDays = (day: StudyDay, days: number): StudyDay =>
  fromWall(toWall(day) + days * DAY_MS);

/** When `day`'s Day start happens, as an instant in milliseconds. */
const startOf = (day: StudyDay, { timezone, dayStartHour }: StudyDaySettings) =>
  firstInstantAt(toWall(day) + dayStartHour * HOUR_MS, timezone ?? "UTC");

/** When the Study day `day` starts and ends: its Day start, and the next one. */
export function studyDayBounds(
  day: StudyDay,
  settings: StudyDaySettings,
): { start: Date; end: Date } {
  return {
    start: new Date(startOf(day, settings)),
    end: new Date(startOf(addStudyDays(day, 1), settings)),
  };
}

/** The Study day `moment` belongs to: the one whose bounds hold it. */
export function studyDayOf(moment: Date, settings: StudyDaySettings): StudyDay {
  const ms = moment.getTime();
  // The wall clock gives the answer but for the odd hour around a DST change;
  // the bounds settle it.
  let day = fromWall(wallClock(ms, settings.timezone ?? "UTC") - settings.dayStartHour * HOUR_MS);
  while (ms < startOf(day, settings)) day = addStudyDays(day, -1);
  while (ms >= startOf(addStudyDays(day, 1), settings)) day = addStudyDays(day, 1);
  return day;
}
