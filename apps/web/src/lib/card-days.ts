// How the deck page's timeline dates its Cards: each under the day it was
// written, in this browser's zone, with its time in the margin.

const startOfDay = (at: Date) => new Date(at.getFullYear(), at.getMonth(), at.getDate());

/** "Today", "Yesterday", or "Tue 20 Oct" (with the year when it isn't this one). */
export function dayLabel(at: string, now = new Date()): string {
  const date = new Date(at);
  const days = Math.round(
    (startOfDay(now).getTime() - startOfDay(date).getTime()) / (24 * 60 * 60 * 1000),
  );
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  // In two parts: with a year, en-GB would put a comma after the weekday.
  const weekday = date.toLocaleDateString("en-GB", { weekday: "short" });
  const day = date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
  return `${weekday} ${day}`;
}

/** "09:05": the time a Card was written. */
export const timeLabel = (at: string) =>
  new Date(at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

/** "Monday 26 October": the new-card page's dateline. */
export const longDateLabel = (now = new Date()) =>
  now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });

/**
 * Items already newest first, in runs of one day each, keeping their order:
 * one run per `dayLabel`.
 */
export function byDay<T extends { createdAt: string }>(
  items: readonly T[],
  now = new Date(),
): { day: string; items: T[] }[] {
  const days: { day: string; items: T[] }[] = [];
  for (const item of items) {
    const day = dayLabel(item.createdAt, now);
    const last = days.at(-1);
    if (last?.day === day) last.items.push(item);
    else days.push({ day, items: [item] });
  }
  return days;
}
