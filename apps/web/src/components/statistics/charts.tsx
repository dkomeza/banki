import { useNavigate } from "@tanstack/react-router";
import { type KeyboardEvent, useMemo, useState } from "react";
import {
  RANGES,
  type Range,
  type Statistics,
  addDays,
  calendarWeeks,
  dateOf,
  levelsOf,
  longDay,
  minutesOf,
  modelName,
  monthOf,
  percent,
  shortDay,
  tooltipDay,
} from "@/lib/statistics-proto";
import { cn } from "@/lib/utils";

// PROTOTYPE (BAN-53): the charts, hand-written SVG on the index.css tokens.
// Each Variant lays them out its own way.

/** Sets `?range=`, leaving the default, 30, out of the URL, and drops a Variant's `?state=`. */
export function useSetRange() {
  const navigate = useNavigate();
  return (range: Range) => {
    const url = new URL(window.location.href);
    url.searchParams.delete("state");
    if (range === "30") url.searchParams.delete("range");
    else url.searchParams.set("range", range);
    void navigate({ href: url.pathname + url.search + url.hash, replace: true });
  };
}

/** The range as a row of pills, one pressed. */
export function RangePills({
  value,
  className,
  short = false,
}: {
  value: Range;
  className?: string;
  short?: boolean;
}) {
  const setRange = useSetRange();
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
          aria-label={short ? r.label : undefined}
          onClick={() => setRange(r.value)}
          className="h-11 flex-1 rounded-full px-4 text-sm font-medium whitespace-nowrap text-muted-foreground outline-none transition-colors motion-reduce:transition-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-solid aria-pressed:bg-primary aria-pressed:text-primary-foreground lg:h-8 lg:px-3.5"
        >
          {short ? r.short : r.label}
        </button>
      ))}
    </div>
  );
}

/** The range as underlined tabs, a quieter row. */
export function RangeTabs({ value, className }: { value: Range; className?: string }) {
  const setRange = useSetRange();
  return (
    <div role="group" aria-label="Range" className={cn("flex gap-5 border-b", className)}>
      {RANGES.map((r) => (
        <button
          key={r.value}
          type="button"
          aria-pressed={r.value === value}
          onClick={() => setRange(r.value)}
          className="-mb-px h-11 border-b-2 border-transparent text-[0.95rem] whitespace-nowrap text-muted-foreground outline-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-solid aria-pressed:border-primary aria-pressed:font-medium aria-pressed:text-foreground lg:h-10"
        >
          {r.label}
        </button>
      ))}
    </div>
  );
}

export const rangeLabel = (stats: Statistics) =>
  stats.range === "all"
    ? `since ${shortDay(stats.from)}`
    : stats.range === "7"
      ? "the last 7 days"
      : `the last ${stats.range} days`;

export const reviewsLabel = (n: number) =>
  `${n.toLocaleString("en-GB")} ${n === 1 ? "review" : "reviews"}`;
export const minutesLabel = (ms: number) => {
  const m = minutesOf(ms);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};

const LEVEL_FILL = [
  "var(--secondary)",
  "color-mix(in oklch, var(--primary) 28%, var(--card))",
  "color-mix(in oklch, var(--primary) 52%, var(--card))",
  "color-mix(in oklch, var(--primary) 76%, var(--card))",
  "var(--primary)",
];

export function CalendarLegend({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-1.5 text-xs text-muted-foreground", className)}>
      Less
      {LEVEL_FILL.map((fill, i) => (
        <span key={i} className="size-2.5 rounded-[2px]" style={{ background: fill }} />
      ))}
      More
    </div>
  );
}

const WEEKDAYS = ["Mon", "", "Wed", "", "Fri", "", ""];

/**
 * The activity calendar: 53 weeks to the current one, Monday first, each Study
 * day shaded in 5 levels. Weeks run left to right as columns, or, `vertical`,
 * top to bottom as rows. A tooltip gives the date, the Reviews and the minutes;
 * arrow keys move it while the calendar has focus.
 */
export function ActivityCalendar({
  stats,
  state,
  cell = 11,
  gap = 3,
  vertical = false,
  fit = false,
  className,
}: {
  stats: Statistics;
  state: string | undefined;
  cell?: number;
  gap?: number;
  vertical?: boolean;
  /** Scales the SVG to its box's width instead of drawing at `cell`. */
  fit?: boolean;
  className?: string;
}) {
  const weeks = useMemo(() => calendarWeeks(stats.to), [stats.to]);
  const byDay = useMemo(() => new Map(stats.calendar.map((d) => [d.day, d])), [stats.calendar]);
  const level = useMemo(() => levelsOf(stats.calendar), [stats.calendar]);
  const [active, setActive] = useState<string | undefined>(() =>
    state === "tooltip" ? tooltipDay(stats) : undefined,
  );
  const step = cell + gap;
  const labelW = vertical ? 30 : 28;
  const labelH = vertical ? 16 : 16;
  const width = vertical ? labelW + 7 * step : labelW + weeks.length * step;
  const height = vertical ? labelH + weeks.length * step : labelH + 7 * step;
  const at = (w: number, d: number) =>
    vertical
      ? { x: labelW + d * step, y: labelH + w * step }
      : { x: labelW + w * step, y: labelH + d * step };

  const months: { label: string; pos: number }[] = [];
  weeks.forEach((week, w) => {
    const first = week.find(
      (d) => d !== null && dateOf(d).getDate() <= 7 && dateOf(d).getDay() === 1,
    );
    if (first !== undefined && first !== null) months.push({ label: monthOf(first), pos: w });
  });

  const activePos = (() => {
    if (active === undefined) return undefined;
    for (const [w, week] of weeks.entries()) {
      const d = week.indexOf(active);
      if (d >= 0) return at(w, d);
    }
    return undefined;
  })();

  const onKey = (event: KeyboardEvent) => {
    const moves: Record<string, number> = vertical
      ? { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }
      : { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1 };
    const by = moves[event.key];
    if (by === undefined) return;
    event.preventDefault();
    const next = addDays(active ?? stats.to, active === undefined ? 0 : by);
    if (next <= stats.to && next >= (weeks[0]?.[0] ?? next)) setActive(next);
  };

  const shown =
    active === undefined ? undefined : (byDay.get(active) ?? { day: active, reviews: 0, ms: 0 });
  const total = stats.calendar.reduce((s, d) => s + d.reviews, 0);

  return (
    <div
      className={cn("relative", className)}
      onPointerLeave={() => state !== "tooltip" && setActive(undefined)}
    >
      <svg
        role="img"
        tabIndex={0}
        aria-label={`Activity over the last 53 weeks: ${reviewsLabel(total)} on ${stats.calendar.length} days. Use the arrow keys to read a day.`}
        viewBox={`0 0 ${width} ${height}`}
        width={fit ? "100%" : width}
        height={fit ? undefined : height}
        onKeyDown={onKey}
        onFocus={() => active === undefined && setActive(stats.to)}
        onBlur={() => state !== "tooltip" && setActive(undefined)}
        className="block rounded-md outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring focus-visible:outline-solid"
      >
        {months.map(({ label, pos }) =>
          vertical ? (
            <text
              key={pos}
              x={0}
              y={labelH + pos * step + cell - 1}
              className="fill-muted-foreground text-[9px]"
            >
              {label}
            </text>
          ) : (
            <text
              key={pos}
              x={labelW + pos * step}
              y={10}
              className="fill-muted-foreground text-[9px]"
            >
              {label}
            </text>
          ),
        )}
        {WEEKDAYS.map((label, d) =>
          label === "" ? null : vertical ? (
            <text
              key={d}
              x={labelW + d * step + cell / 2}
              y={10}
              textAnchor="middle"
              className="fill-muted-foreground text-[9px]"
            >
              {label[0]}
            </text>
          ) : (
            <text
              key={d}
              x={0}
              y={labelH + d * step + cell - 2}
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
            const { x, y } = at(w, d);
            return (
              <rect
                key={day}
                x={x}
                y={y}
                width={cell}
                height={cell}
                rx={Math.max(1.5, cell / 5)}
                fill={LEVEL_FILL[level(data?.reviews ?? 0)]}
                stroke={day === active ? "var(--foreground)" : "none"}
                strokeWidth={1.5}
                aria-label={`${longDay(day)}: ${reviewsLabel(data?.reviews ?? 0)}, ${minutesLabel(data?.ms ?? 0)}`}
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
      {shown !== undefined && activePos !== undefined ? (
        <CalendarTooltip
          day={shown}
          x={(activePos.x + cell / 2) / width}
          top={activePos.y / height}
          bottom={(activePos.y + cell) / height}
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
  day: { day: string; reviews: number; ms: number };
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

const niceMax = (max: number) => {
  for (const step of [5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240, 360, 480, 600, 900, 1200])
    if (max <= step) return step;
  return Math.ceil(max / 600) * 600;
};

/** Minutes per day, or per week for a long All time, as bars over the range with zeros. */
export function MinutesBars({
  stats,
  height = 160,
  barColor = "var(--chart-4)",
  className,
}: {
  stats: Statistics;
  height?: number;
  barColor?: string;
  className?: string;
}) {
  const { points, bucket } = stats.minutes;
  const mins = points.map((p) => p.ms / 60_000);
  const top = niceMax(Math.max(1, ...mins));
  const n = points.length;
  const w = 10;
  const g = n > 40 ? 2 : n > 10 ? 3 : 6;
  const vw = n * (w + g) - g;
  const first = points[0]?.start ?? stats.from;
  const last = points.at(-1)?.start ?? stats.to;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="relative" style={{ height }}>
        {mins.every((m) => m === 0) ? (
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
          role="img"
          aria-label={`Minutes per ${bucket}, ${shortDay(first)} to ${shortDay(last)}`}
          viewBox={`0 0 ${vw} 100`}
          preserveAspectRatio="none"
          className="absolute inset-0 size-full overflow-visible"
        >
          {points.map((p, i) => {
            const h = (p.ms / 60_000 / top) * 100;
            return (
              <rect
                key={p.start}
                x={i * (w + g)}
                y={100 - h}
                width={w}
                height={Math.max(h, p.ms > 0 ? 1.5 : 0.6)}
                rx={n > 40 ? 0.8 : 1.5}
                fill={p.ms > 0 ? barColor : "var(--border)"}
                aria-label={`${bucket === "week" ? `Week of ${shortDay(p.start)}` : longDay(p.start)}: ${minutesLabel(p.ms)}`}
              >
                <title>{`${bucket === "week" ? `Week of ${shortDay(p.start)}` : longDay(p.start)}: ${minutesLabel(p.ms)}`}</title>
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

export function minutesSummary(stats: Statistics) {
  const total = stats.minutes.points.reduce((s, p) => s + p.ms, 0);
  const days = Math.max(
    1,
    Math.round((dateOf(stats.to).getTime() - dateOf(stats.from).getTime()) / 86_400_000) + 1,
  );
  return { total, perDay: total / days };
}

export const retentionOf = (stats: Statistics) => {
  const { recalled, total, desiredRetention } = stats.actualRetention;
  return { value: percent(recalled, total), total, recalled, desired: desiredRetention };
};

export const fmtPct = (n: number, digits = 1) =>
  `${n.toLocaleString("en-GB", { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;

const pos = (v: number) => `${Math.min(100, Math.max(0, ((v - 70) / 30) * 100))}%`;

/** Actual retention beside Desired retention on a 70 to 100% track. */
export function RetentionTrack({ stats, className }: { stats: Statistics; className?: string }) {
  const r = retentionOf(stats);
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="relative h-3 rounded-full bg-secondary">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-primary"
          style={{ width: pos(r.value) }}
        />
        <div
          className="absolute -inset-y-1.5 w-0.5 rounded-full bg-foreground"
          style={{ left: pos(r.desired) }}
          aria-hidden
        />
      </div>
      <div className="relative h-4 text-xs text-muted-foreground tabular-nums">
        <span className="absolute left-0">70%</span>
        <span
          className="absolute -translate-x-1/2 font-medium text-foreground"
          style={{ left: pos(r.desired) }}
        >
          Desired {fmtPct(r.desired, r.desired % 1 === 0 ? 0 : 1)}
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

/** Cards by stage as one stacked bar. */
export function StageBar({ stats, className }: { stats: Statistics; className?: string }) {
  const total = stats.cards.new + stats.cards.learning + stats.cards.learned;
  return (
    <div
      role="img"
      aria-label={STAGES.map((s) => `${stats.cards[s.key]} ${s.label.toLowerCase()}`).join(", ")}
      className={cn("flex h-3 gap-0.5 overflow-hidden rounded-full bg-secondary", className)}
    >
      {STAGES.map((s) =>
        stats.cards[s.key] === 0 ? null : (
          <div
            key={s.key}
            style={{ flexGrow: stats.cards[s.key] / Math.max(1, total), background: s.fill }}
          />
        ),
      )}
    </div>
  );
}

export const AGREEMENT = [
  { key: "kept", label: "Kept", fill: "var(--primary)" },
  { key: "higher", label: "Rated higher", fill: "var(--chart-4)" },
  { key: "lower", label: "Rated lower", fill: "var(--chart-5)" },
] as const;

type Split = { kept: number; higher: number; lower: number };
export const graded = (s: Split) => s.kept + s.higher + s.lower;

/** Kept, higher and lower as one stacked bar. */
export function AgreementBar({ split, className }: { split: Split; className?: string }) {
  const total = graded(split);
  return (
    <div
      role="img"
      aria-label={`${split.kept} kept, ${split.higher} rated higher, ${split.lower} rated lower`}
      className={cn("flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-secondary", className)}
    >
      {AGREEMENT.map((a) =>
        split[a.key] === 0 ? null : (
          <div
            key={a.key}
            style={{ flexGrow: split[a.key] / Math.max(1, total), background: a.fill }}
          />
        ),
      )}
    </div>
  );
}

export { modelName };

export function Swatch({ fill }: { fill: string }) {
  return (
    <span
      aria-hidden
      className="inline-block size-2.5 shrink-0 rounded-[3px]"
      style={{ background: fill }}
    />
  );
}

export const NO_LEARNED = "No reviews of learned cards in this range";
export const NO_GRADED = "No graded reviews in this range";
