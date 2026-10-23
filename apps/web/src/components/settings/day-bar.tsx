import type { SettingsResponse } from "@banki/shared";
import { useState } from "react";
import { describeStudyDay, formatHour } from "@/lib/time";
import { cn } from "@/lib/utils";

const TICKS = [0, 6, 12, 18, 24];

const tickLabel = (hour: number) =>
  hour === 0 || hour === 24 ? "midnight" : formatHour(hour).replace(":00", "");

/** The hatching of the hours that count toward yesterday. */
const HATCH = "repeating-linear-gradient(135deg, var(--muted) 0 6px, var(--border) 6px 12px)";
const SWATCH = "repeating-linear-gradient(135deg, var(--muted) 0 3px, var(--input) 3px 5px)";

/**
 * The 24 hours of a calendar day, with the Day start marked: the hours before
 * it hatched, as they count toward yesterday, and the rest Today's Study day.
 * What it means for today, from the Study day functions, is its description.
 */
export function DayBar({ settings }: { settings: SettingsResponse }) {
  const { dayStartHour } = settings;
  // When the page opened: what "today" is for the description.
  const [now] = useState(() => new Date());
  const percent = (dayStartHour / 24) * 100;
  const start = formatHour(dayStartHour);
  return (
    <figure className="flex flex-col gap-2">
      <div
        role="img"
        aria-label={`${describeStudyDay(now, settings)} Before ${start} counts toward the day before.`}
        className="relative pt-8"
      >
        <div
          aria-hidden
          className="absolute top-0 flex -translate-x-1/2"
          // Kept clear of the ends, so the label never overflows the bar.
          style={{ left: `${Math.min(Math.max(percent, 9), 91)}%` }}
        >
          <span className="rounded-full bg-foreground px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap text-background">
            {start}
          </span>
        </div>
        <div aria-hidden className="relative flex h-12 overflow-hidden rounded-xl">
          {dayStartHour > 0 && <div style={{ width: `${percent}%`, backgroundImage: HATCH }} />}
          <div className="flex min-w-0 flex-1 items-center bg-primary px-3 text-sm font-semibold whitespace-nowrap text-primary-foreground">
            Today's Study day
          </div>
          <div className="absolute inset-y-0 w-0.5 bg-foreground" style={{ left: `${percent}%` }} />
        </div>
      </div>
      <div aria-hidden className="relative h-5 text-xs text-muted-foreground">
        {TICKS.map((hour) => (
          <span
            key={hour}
            className={cn(
              "absolute top-0",
              hour === 0 ? "left-0" : hour === 24 ? "right-0" : "-translate-x-1/2",
              (hour === 6 || hour === 18) && "hidden sm:block",
            )}
            style={hour === 0 || hour === 24 ? undefined : { left: `${(hour / 24) * 100}%` }}
          >
            {tickLabel(hour)}
          </span>
        ))}
      </div>
      {dayStartHour > 0 && (
        <figcaption aria-hidden className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="inline-block size-3 rounded-sm" style={{ backgroundImage: SWATCH }} />
          Before {start} counts toward yesterday
        </figcaption>
      )}
    </figure>
  );
}
