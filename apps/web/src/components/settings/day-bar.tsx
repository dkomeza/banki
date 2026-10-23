import type { SettingsResponse } from "@banki/shared";
import { useLayoutEffect, useRef, useState } from "react";
import { describeStudyDay, formatHour } from "@/lib/time";
import { cn } from "@/lib/utils";

const TICKS = [0, 6, 12, 18, 24];

const tickLabel = (hour: number) =>
  hour === 0 || hour === 24 ? "midnight" : formatHour(hour).replace(":00", "");

/** The hatching of the hours that count toward yesterday. */
const HATCH = "repeating-linear-gradient(135deg, var(--muted) 0 6px, var(--border) 6px 12px)";
const SWATCH = "repeating-linear-gradient(135deg, var(--muted) 0 3px, var(--input) 3px 5px)";

/** The segment's padding either side of its label (px-3). */
const LABEL_PADDING = 24;

/**
 * Where the Day start's pill goes, and whether the segment holds its label:
 * measured, since both depend on the bar's width.
 */
type Layout = { pillLeft: number; labelFits: boolean };

/**
 * The 24 hours of a calendar day, with the Day start marked: the hours before
 * it hatched, as they count toward yesterday, and the rest Today's Study day.
 * What it means for today, from the Study day functions, is its description.
 *
 * The Day start's pill is centred on its marker but kept within the bar, so
 * near either end it lines up with the marker instead. When the Study day's
 * segment is too narrow for its label (a late Day start on a phone), the label
 * moves to the legend under the bar.
 */
export function DayBar({ settings }: { settings: SettingsResponse }) {
  const { dayStartHour } = settings;
  // When the page opened: what "today" is for the description.
  const [now] = useState(() => new Date());
  const percent = (dayStartHour / 24) * 100;
  const start = formatHour(dayStartHour);
  const barRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLSpanElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);
  const [layout, setLayout] = useState<Layout>();

  useLayoutEffect(() => {
    const bar = barRef.current;
    const pill = pillRef.current;
    const label = labelRef.current;
    if (bar === null || pill === null || label === null) return undefined;
    const measure = () => {
      const width = bar.clientWidth;
      const marker = (dayStartHour / 24) * width;
      setLayout({
        pillLeft: Math.min(Math.max(marker - pill.offsetWidth / 2, 0), width - pill.offsetWidth),
        labelFits: width - marker >= label.offsetWidth + LABEL_PADDING,
      });
    };
    measure();
    const resized = new ResizeObserver(measure);
    resized.observe(bar);
    return () => resized.disconnect();
  }, [dayStartHour]);

  const labelFits = layout?.labelFits ?? true;
  return (
    <figure className="flex flex-col gap-2">
      <div
        role="img"
        aria-label={`${describeStudyDay(now, settings)} Before ${start} counts toward the day before.`}
        className="relative pt-8"
      >
        <div
          aria-hidden
          className="absolute top-0 flex"
          // Until measured, centred on the marker.
          style={
            layout === undefined
              ? { left: `${percent}%`, transform: "translateX(-50%)" }
              : { left: layout.pillLeft }
          }
        >
          <span
            ref={pillRef}
            className="rounded-full bg-foreground px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap text-background"
          >
            {start}
          </span>
        </div>
        <div ref={barRef} aria-hidden className="relative flex h-12 overflow-hidden rounded-xl">
          {dayStartHour > 0 && <div style={{ width: `${percent}%`, backgroundImage: HATCH }} />}
          <div className="flex min-w-0 flex-1 items-center bg-primary px-3 text-sm font-semibold whitespace-nowrap text-primary-foreground">
            {/* Kept for measuring when it doesn't fit, but not shown. */}
            <span ref={labelRef} className={cn(!labelFits && "invisible")}>
              Today's Study day
            </span>
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
      {(dayStartHour > 0 || !labelFits) && (
        <figcaption
          aria-hidden
          className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm text-muted-foreground"
        >
          {!labelFits && (
            <span className="flex items-center gap-2">
              <span className="inline-block size-3 rounded-sm bg-primary" />
              Today's Study day
            </span>
          )}
          {dayStartHour > 0 && (
            <span className="flex items-center gap-2">
              <span
                className="inline-block size-3 rounded-sm"
                style={{ backgroundImage: SWATCH }}
              />
              Before {start} counts toward yesterday
            </span>
          )}
        </figcaption>
      )}
    </figure>
  );
}
