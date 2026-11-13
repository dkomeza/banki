import type { StatisticsRange, StudyDay } from "@banki/shared";
import { addStudyDays } from "@banki/shared";
import { type KeyboardEvent, useMemo, useState } from "react";
import {
  RANGES,
  type Statistics,
  calendarWeeks,
  dateOf,
  levelsOf,
  longDay,
  minutesLabel,
  monthOf,
  percentLabel,
  reviewsLabel,
  shortDay,
} from "@/lib/statistics";
import { cn } from "@/lib/utils";

// The Statistics pages' charts: hand-written SVG and boxes on the index.css
// tokens, no chart library. Each one's values can be read as text, and as
// accessible names.

/** The range as a row of pills, the chosen one pressed. 44 px tall below 1024 px. */
export function RangePills({
  value,
  onChange,
  className,
}: {
  value: StatisticsRange;
  onChange: (range: StatisticsRange) => void;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label="Range"
      className={cn(
        "inline-flex w-fit rounded-full border border-input bg-background p-1 dark:bg-input/20",
        className,
      )}
    >
      {RANGES.map((r) => (
        <button
          key={r.value}
          type="button"
          aria-pressed={r.value === value}
          onClick={() => onChange(r.value)}
          className="h-11 flex-1 rounded-full px-4 text-sm font-medium whitespace-nowrap text-muted-foreground outline-none transition-colors motion-reduce:transition-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-solid aria-pressed:bg-primary aria-pressed:text-primary-foreground lg:h-8 lg:px-3.5"
        >
          {r.label}
        </button>
      ))}
    </div>
  );
}

/** The calendar's fills, from no Reviews to the busiest quarter of days. */
export const LEVEL_FILL = [
  "var(--secondary)",
  "color-mix(in oklch, var(--primary) 28%, var(--card))",
  "color-mix(in oklch, var(--primary) 52%, var(--card))",
  "color-mix(in oklch, var(--primary) 76%, var(--card))",
  "var(--primary)",
] as const;

export function CalendarLegend({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("flex items-center gap-1.5 text-xs text-muted-foreground", className)}
    >
      Less
      {LEVEL_FILL.map((fill) => (
        <span key={fill} className="size-2.5 rounded-[2px]" style={{ background: fill }} />
      ))}
      More
    </div>
  );
}

const WEEKDAYS = ["Mon", "", "Wed", "", "Fri", "", ""];
const CELL = 11;
const GAP = 3;
const STEP = CELL + GAP;
const LABEL_W = 28;
const LABEL_H = 16;

/**
 * The activity calendar: the 53 weeks to the current one as columns, Monday
 * at the top, each Study day shaded by its Reviews in 5 levels (`levelsOf`).
 * Hovering, tapping or focusing a day opens its tooltip, with the date, the
 * Reviews and the minutes; arrow keys move it while the calendar has focus.
 * `fit` scales it to its box's width instead of drawing it at its size.
 */
export function ActivityCalendar({
  stats,
  fit = false,
  className,
}: {
  stats: Statistics;
  fit?: boolean;
  className?: string;
}) {
  const weeks = useMemo(() => calendarWeeks(stats.to), [stats.to]);
  const byDay = useMemo(() => new Map(stats.calendar.map((d) => [d.day, d])), [stats.calendar]);
  const level = useMemo(() => levelsOf(stats.calendar), [stats.calendar]);
  const [active, setActive] = useState<StudyDay | undefined>();
  const width = LABEL_W + weeks.length * STEP;
  const height = LABEL_H + 7 * STEP;
  const first = weeks[0]?.[0] ?? stats.to;

  // A month's label goes over the week its first Monday is in.
  const months: { label: string; week: number }[] = [];
  weeks.forEach((week, w) => {
    const monday = week[0];
    if (monday !== null && monday !== undefined && dateOf(monday) <= 7)
      months.push({ label: monthOf(monday), week: w });
  });

  const position = (day: StudyDay) => {
    for (const [w, week] of weeks.entries()) {
      const d = week.indexOf(day);
      if (d >= 0) return { x: LABEL_W + w * STEP, y: LABEL_H + d * STEP };
    }
    return undefined;
  };
  const at = active === undefined ? undefined : position(active);

  const onKey = (event: KeyboardEvent) => {
    const by = { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1 }[event.key];
    if (by === undefined) return;
    event.preventDefault();
    const next = active === undefined ? stats.to : addStudyDays(active, by);
    if (next <= stats.to && next >= first) setActive(next);
  };

  const total = stats.calendar.reduce((sum, d) => sum + d.reviews, 0);
  const shown =
    active === undefined ? undefined : (byDay.get(active) ?? { day: active, reviews: 0, ms: 0 });

  return (
    <div className={cn("relative", className)} onPointerLeave={() => setActive(undefined)}>
      {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- the arrow keys read the days */}
      <svg
        role="group"
        tabIndex={0}
        aria-label={`Activity over the last 53 weeks: ${reviewsLabel(total)} on ${stats.calendar.length} days. Use the arrow keys to read a day.`}
        viewBox={`0 0 ${width} ${height}`}
        width={fit ? "100%" : width}
        height={fit ? undefined : height}
        onKeyDown={onKey}
        onFocus={() => setActive((day) => day ?? stats.to)}
        onBlur={() => setActive(undefined)}
        className="block rounded-md outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring focus-visible:outline-solid"
      >
        {months.map(({ label, week }) => (
          <text
            key={week}
            aria-hidden
            x={LABEL_W + week * STEP}
            y={10}
            className="fill-muted-foreground text-[9px]"
          >
            {label}
          </text>
        ))}
        {WEEKDAYS.map((label, d) =>
          label === "" ? null : (
            <text
              key={label}
              aria-hidden
              x={0}
              y={LABEL_H + d * STEP + CELL - 2}
              className="fill-muted-foreground text-[9px]"
            >
              {label}
            </text>
          ),
        )}
        {weeks.map((week, w) =>
          week.map((day, d) => {
            if (day === null) return null;
            const data = byDay.get(day);
            const reviews = data?.reviews ?? 0;
            return (
              <rect
                key={day}
                role="img"
                aria-label={`${longDay(day)}: ${reviewsLabel(reviews)}, ${minutesLabel(data?.ms ?? 0)}`}
                data-level={level(reviews)}
                x={LABEL_W + w * STEP}
                y={LABEL_H + d * STEP}
                width={CELL}
                height={CELL}
                rx={2.2}
                fill={LEVEL_FILL[level(reviews)]}
                stroke={day === active ? "var(--foreground)" : "none"}
                strokeWidth={1.5}
                onPointerEnter={() => setActive(day)}
                onClick={() => setActive(day)}
              />
            );
          }),
        )}
      </svg>
      {stats.calendar.length === 0 ? (
        <p className="absolute inset-0 flex items-center justify-center">
          <span className="rounded-full bg-card px-4 py-1.5 text-sm text-muted-foreground shadow-sm">
            No reviews in the last 53 weeks
          </span>
        </p>
      ) : null}
      {shown !== undefined && at !== undefined ? (
        <CalendarTooltip
          day={shown}
          x={(at.x + CELL / 2) / width}
          top={at.y / height}
          bottom={(at.y + CELL) / height}
        />
      ) : null}
    </div>
  );
}

function CalendarTooltip({
  day,
  x,
  top,
  bottom,
}: {
  day: Statistics["calendar"][number];
  /** The cell's centre and edges, as fractions of the calendar's box. */
  x: number;
  top: number;
  bottom: number;
}) {
  // Under the cell in the top rows, over it lower down; kept inside the box at its ends.
  const below = top < 0.5;
  return (
    <div
      role="tooltip"
      style={{ left: `${x * 100}%`, top: `${(below ? bottom : top) * 100}%` }}
      className={cn(
        "pointer-events-none absolute z-10 w-max max-w-56 rounded-lg bg-foreground px-3 py-2 text-xs text-background shadow-lg",
        x > 0.7
          ? "-translate-x-[calc(100%-12px)]"
          : x < 0.3
            ? "-translate-x-3"
            : "-translate-x-1/2",
        below ? "translate-y-2" : "-translate-y-[calc(100%+8px)]",
      )}
    >
      <p className="font-medium">{longDay(day.day)}</p>
      <p className="tabular-nums opacity-80">
        {day.reviews === 0
          ? "No reviews"
          : `${reviewsLabel(day.reviews)} · ${minutesLabel(day.ms)}`}
      </p>
    </div>
  );
}

/** The axis's top, in minutes: the first round number at or above the busiest bar. */
const niceMax = (max: number) => {
  for (const step of [5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240, 360, 480, 600, 900, 1200])
    if (max <= step) return step;
  return Math.ceil(max / 600) * 600;
};

/** Minutes per day, or per week for a long All time, as bars over the range, zeros included. */
export function MinutesBars({
  stats,
  height = 160,
  className,
}: {
  stats: Statistics;
  height?: number;
  className?: string;
}) {
  const { points, bucket } = stats.minutes;
  const top = niceMax(Math.max(1, ...points.map((p) => p.ms / 60_000)));
  const n = points.length;
  const w = 10;
  const g = n > 40 ? 2 : n > 10 ? 3 : 6;
  const viewWidth = Math.max(1, n * (w + g) - g);
  const first = points[0]?.start ?? stats.from;
  const last = points.at(-1)?.start ?? stats.to;
  const label = (start: StudyDay, ms: number) =>
    `${bucket === "week" ? `Week of ${shortDay(start)}` : longDay(start)}: ${minutesLabel(ms)}`;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="relative" style={{ height }}>
        {points.every((p) => p.ms === 0) ? (
          <p className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            No study time in this range
          </p>
        ) : null}
        <div className="absolute inset-x-0 top-0 border-t border-dashed border-border" />
        <span className="absolute top-0 right-0 -translate-y-full pb-0.5 text-xs text-muted-foreground tabular-nums">
          {top} min
        </span>
        <div className="absolute inset-x-0 top-1/2 border-t border-dashed border-border/70" />
        <svg
          role="group"
          aria-label={`Minutes per ${bucket}, ${shortDay(first)} to ${shortDay(last)}`}
          viewBox={`0 0 ${viewWidth} 100`}
          preserveAspectRatio="none"
          className="absolute inset-0 size-full overflow-visible"
        >
          {points.map((p, i) => {
            const h = (p.ms / 60_000 / top) * 100;
            return (
              <rect
                key={p.start}
                role="img"
                aria-label={label(p.start, p.ms)}
                x={i * (w + g)}
                y={100 - h}
                width={w}
                height={Math.max(h, p.ms > 0 ? 1.5 : 0.6)}
                rx={n > 40 ? 0.8 : 1.5}
                fill={p.ms > 0 ? "var(--chart-4)" : "var(--border)"}
              >
                <title>{label(p.start, p.ms)}</title>
              </rect>
            );
          })}
        </svg>
      </div>
      <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
        <span>{bucket === "week" ? `Week of ${shortDay(first)}` : shortDay(first)}</span>
        <span>{bucket === "week" ? "This week" : "Today"}</span>
      </div>
    </div>
  );
}

/** Where a percentage sits on the 70 to 100% track. */
const along = (value: number) => `${Math.min(100, Math.max(0, ((value - 70) / 30) * 100))}%`;

/** Actual retention beside Desired retention, on a 70 to 100% track. */
export function RetentionTrack({
  actual,
  desired,
  className,
}: {
  actual: number;
  desired: number;
  className?: string;
}) {
  const desiredLabel = percentLabel(desired, Number.isInteger(desired) ? 0 : 1);
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div
        role="img"
        aria-label={`Actual retention ${percentLabel(actual)}, Desired retention ${desiredLabel}`}
        className="relative h-3 rounded-full bg-secondary"
      >
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-primary"
          style={{ width: along(actual) }}
        />
        <div
          className="absolute -inset-y-1.5 w-0.5 rounded-full bg-foreground"
          style={{ left: along(desired) }}
        />
      </div>
      <div aria-hidden className="relative h-4 text-xs text-muted-foreground tabular-nums">
        <span className="absolute left-0">70%</span>
        <span
          className="absolute -translate-x-1/2 font-medium text-foreground"
          style={{ left: along(desired) }}
        >
          Desired {desiredLabel}
        </span>
        <span className="absolute right-0">100%</span>
      </div>
    </div>
  );
}

export const STAGES = [
  { key: "new", label: "New", fill: "var(--chart-4)" },
  { key: "learning", label: "Learning", fill: "var(--chart-2)" },
  { key: "learned", label: "Learned", fill: "var(--primary)" },
] as const;

type Parts<K extends string> = Readonly<Record<K, number>>;

/** Parts of a whole as one stacked bar, named by its parts' counts. */
function StackedBar<K extends string>({
  parts,
  values,
  label,
  className,
}: {
  parts: readonly { key: K; fill: string }[];
  values: Parts<K>;
  label: string;
  className?: string;
}) {
  const total = parts.reduce((sum, p) => sum + values[p.key], 0);
  return (
    <div
      role="img"
      aria-label={label}
      className={cn("flex gap-0.5 overflow-hidden rounded-full bg-secondary", className)}
    >
      {parts.map((p) =>
        values[p.key] === 0 ? null : (
          <div
            key={p.key}
            style={{ flexGrow: values[p.key] / Math.max(1, total), background: p.fill }}
          />
        ),
      )}
    </div>
  );
}

/** Cards by stage as one stacked bar. */
export function StageBar({ cards }: { cards: Statistics["cards"] }) {
  return (
    <StackedBar
      parts={STAGES}
      values={cards}
      label={STAGES.map((s) => `${cards[s.key]} ${s.label.toLowerCase()}`).join(", ")}
      className="h-3"
    />
  );
}

export const AGREEMENT = [
  { key: "kept", label: "Kept", fill: "var(--primary)" },
  { key: "higher", label: "Rated higher", fill: "var(--chart-4)" },
  { key: "lower", label: "Rated lower", fill: "var(--chart-5)" },
] as const;

export type Agreement = Parts<"kept" | "higher" | "lower">;
export const gradedOf = (split: Agreement) => split.kept + split.higher + split.lower;

/** Kept, rated higher and rated lower as one stacked bar. */
export function AgreementBar({ split, className }: { split: Agreement; className?: string }) {
  return (
    <StackedBar
      parts={AGREEMENT}
      values={split}
      label={`${split.kept} kept, ${split.higher} rated higher, ${split.lower} rated lower`}
      className={cn("h-2.5", className)}
    />
  );
}

export function Swatch({ fill }: { fill: string }) {
  return (
    <span
      aria-hidden
      className="inline-block size-2.5 shrink-0 rounded-[3px]"
      style={{ background: fill }}
    />
  );
}
