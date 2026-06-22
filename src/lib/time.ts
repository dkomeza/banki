export function zonedDateEnd(date: string, timezone: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  const targetWallTime = Date.UTC(year, month - 1, day, 23, 59, 59);
  const probe = new Date(targetWallTime);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(probe);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((item) => item.type === type)?.value);
  const represented = Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"), part("second"));
  return new Date(targetWallTime - (represented - targetWallTime) + 999);
}

export function daysUntil(deadline: Date, now = new Date()) {
  return Math.max(1, Math.ceil((deadline.getTime() - now.getTime()) / 86_400_000));
}

export function formatMinutes(seconds: number) {
  const minutes = Math.max(1, Math.round(seconds / 60));
  return `${minutes} min`;
}
