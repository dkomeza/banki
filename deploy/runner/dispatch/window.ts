import { ConfigError } from "../lib/config";

// The window Stages start in (ADR-0013), in server time: every night, and all
// day on the open days. An open day runs on until the night after it ends,
// so with the defaults Saturday 00:00 to Monday 07:00 is one stretch. A
// Stage that is running finishes past the window. Pure, so it is unit-tested.

/** A night, in minutes after midnight. `end` before `start` crosses midnight. */
export type Night = { start: number; end: number };
export type Window = { night: Night; openDays: ReadonlySet<number> };
/** A moment as the server's clock shows it: the weekday (0 is Sunday) and the minutes after midnight. */
export type LocalTime = { weekday: number; minutes: number };

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export function inWindow(at: LocalTime, window: Window): boolean {
  const { start, end } = window.night;
  const night =
    start < end ? at.minutes >= start && at.minutes < end : at.minutes >= start || at.minutes < end;
  if (night || window.openDays.has(at.weekday)) return true;
  // The early hours after an open day, up to the night's end.
  return window.openDays.has((at.weekday + 6) % 7) && at.minutes < end;
}

/** The weekday and time at `date` in `timeZone` (the server's TZ when undefined). */
export function localTime(date: Date, timeZone?: string): LocalTime {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: string) => parts.find((found) => found.type === type)?.value ?? "";
  return {
    weekday: DAYS.indexOf(part("weekday").toLowerCase()),
    minutes: Number(part("hour")) * 60 + Number(part("minute")),
  };
}

/** Minutes after midnight, or NaN for a time that isn't one. */
const minutes = (h?: string, m?: string) =>
  Number(h) < 24 && Number(m) < 60 ? Number(h) * 60 + Number(m) : Number.NaN;

/** BANKI_RUNNER_NIGHT: `HH:MM-HH:MM`. */
export function parseNight(text: string): Night {
  const match = /^([0-9]{2}):([0-9]{2})-([0-9]{2}):([0-9]{2})$/.exec(text.trim());
  const start = minutes(match?.[1], match?.[2]);
  const end = minutes(match?.[3], match?.[4]);
  if (match === null || Number.isNaN(start) || Number.isNaN(end) || start === end) {
    throw new ConfigError(
      `BANKI_RUNNER_NIGHT is ${JSON.stringify(text)}: it is a start and an end, such as 01:00-07:00`,
    );
  }
  return { start, end };
}

/** BANKI_RUNNER_OPEN_DAYS: three-letter day names, comma-separated, or nothing. */
export function parseDays(text: string): Set<number> {
  const days = new Set<number>();
  for (const name of text.split(",").map((day) => day.trim().toLowerCase())) {
    if (name === "") continue;
    const day = DAYS.indexOf(name);
    if (day === -1) {
      throw new ConfigError(
        `BANKI_RUNNER_OPEN_DAYS has ${JSON.stringify(name)}: the days are ${DAYS.join(", ")}`,
      );
    }
    days.add(day);
  }
  return days;
}
