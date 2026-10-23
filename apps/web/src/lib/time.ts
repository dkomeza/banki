import { type SettingsResponse, studyDayBounds, studyDayOf } from "@banki/shared";

// How the Settings page writes hours, Timezones and what the Day start does.

/** 4 → "4:00 a.m.", 0 → "midnight", 12 → "noon". */
export function formatHour(hour: number): string {
  if (hour === 0) return "midnight";
  if (hour === 12) return "noon";
  return hour < 12 ? `${hour}:00 a.m.` : `${hour - 12}:00 p.m.`;
}

/** The time of day `at` in `timezone`, as {@link formatHour} writes it: "4:00 a.m.", "3:30 p.m.". */
function formatTime(at: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    hour: "numeric",
    minute: "numeric",
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((candidate) => candidate.type === type)?.value ?? 0);
  const [hour, minute] = [part("hour"), part("minute")];
  if (minute === 0) return formatHour(hour);
  const onClock = hour % 12 === 0 ? 12 : hour % 12;
  return `${onClock}:${String(minute).padStart(2, "0")} ${hour < 12 ? "a.m." : "p.m."}`;
}

/** "12 May": the date `at` in `timezone`. */
const formatDate = (at: Date, timezone: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: timezone, day: "numeric", month: "long" }).format(
    at,
  );

/**
 * When the Study day `now` is in starts and ends, in words, for the Day bar's
 * description: on a day a DST jump shortens or lengthens, the real times.
 */
export function describeStudyDay(now: Date, settings: SettingsResponse): string {
  const timezone = settings.timezone ?? "UTC";
  const { start, end } = studyDayBounds(studyDayOf(now, settings), settings);
  const when = (at: Date) => `${formatTime(at, timezone)} on ${formatDate(at, timezone)}`;
  return `Today's Study day runs from ${when(start)} to ${when(end)}, in ${timezone}.`;
}

/** Half an hour before `hour`: "3:30 a.m." before 4, "11:30 p.m." before midnight. */
function halfHourBefore(hour: number): string {
  const previous = (hour + 23) % 24;
  const onClock = previous % 12 === 0 ? 12 : previous % 12;
  return `${onClock}:30 ${previous < 12 ? "a.m." : "p.m."}`;
}

/** The sentence that shows what the Day start does. */
export function dayStartEffect(dayStartHour: number): string {
  if (dayStartHour === 0) return "Study days follow the calendar: each one starts at midnight.";
  const start = formatHour(dayStartHour);
  return `Each Study day runs from ${start} to ${start}, so a review at ${halfHourBefore(dayStartHour)} counts toward the day before.`;
}

/**
 * The zone's UTC offset at `at`: "UTC+2", "UTC−3:30", or "UTC" for none.
 * Worked out from the wall clock rather than Intl's offset names, which ICU
 * spells differently from platform to platform ("GMT" or "GMT+0",
 * "GMT+5:30" or "GMT+05:30").
 */
export function offsetOf(timezone: string, at = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((candidate) => candidate.type === type)?.value ?? 0);
  const wall = Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"));
  const instant = Math.floor(at.getTime() / 60_000) * 60_000;
  const minutes = Math.round((wall - instant) / 60_000);
  if (minutes === 0) return "UTC";
  const hours = Math.floor(Math.abs(minutes) / 60);
  const rest = Math.abs(minutes) % 60;
  return `UTC${minutes < 0 ? "−" : "+"}${hours}${rest === 0 ? "" : `:${String(rest).padStart(2, "0")}`}`;
}

/** The zone this browser is in. */
export const deviceTimezone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Intl's own spelling of a zone's name, so different spellings of one zone compare equal. */
function canonical(timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: timezone }).resolvedOptions().timeZone;
  } catch {
    return timezone;
  }
}

export const sameTimezone = (a: string, b: string) => canonical(a) === canonical(b);

/** A change to a Setting that didn't save. */
export type FailedSave =
  | { field: "timezone"; attempted: string }
  | { field: "dayStartHour"; attempted: number };

/** What a failed save says: what didn't change, and what is kept instead. */
export function saveErrorText(failed: FailedSave, kept: SettingsResponse): string {
  if (failed.field === "dayStartHour") {
    const still = formatHour(kept.dayStartHour);
    return `The change to ${formatHour(failed.attempted)} didn't save, so Day start is still ${still}${still.endsWith(".") ? "" : "."}`;
  }
  const change = `The change to ${failed.attempted} didn't save`;
  return kept.timezone === null
    ? `${change}, so Banki still counts days in UTC.`
    : `${change}, so Timezone is still ${kept.timezone}.`;
}
