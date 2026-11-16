import type { StatisticsRange } from "@banki/shared";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { Page } from "@/components/page";
import {
  AGREEMENT,
  ActivityCalendar,
  AgreementBar,
  CalendarLegend,
  MinutesBars,
  RangePills,
  RetentionTrack,
  STAGES,
  StageBar,
  Swatch,
  gradedOf,
} from "@/components/statistics/charts";
import {
  type Statistics,
  minutesLabel,
  minutesSummary,
  modelName,
  overRangeLabel,
  percentLabel,
  reviewsLabel,
} from "@/lib/statistics";
import { cn } from "@/lib/utils";

// A Statistics page, global or a Deck's (BAN-53), built as docs/design.md
// builds a page of cards: the title with the range's pills beside it, the
// year's activity first and full width, then the four other charts in two
// columns of masonry, each card's headline figure over its chart. The
// calendar and Cards by stage say they don't follow the range.

export const NO_LEARNED = "No reviews of learned cards in this range";
export const NO_GRADED = "No graded reviews in this range";

export function StatisticsView({
  stats,
  range,
  onRange,
  deckName,
  breadcrumb,
}: {
  stats: Statistics;
  range: StatisticsRange;
  onRange: (range: StatisticsRange) => void;
  /** The Deck's name on a Deck's page; undefined on the global one. */
  deckName?: string;
  breadcrumb?: ReactNode;
}) {
  return (
    <Page width="cards">
      <div className="flex flex-col gap-8 lg:gap-10">
        <div className="flex flex-col gap-4">
          {breadcrumb}
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="flex flex-col gap-3">
              <h1 className="text-[2.25rem] leading-none font-semibold tracking-[-0.035em] lg:text-5xl">
                Statistics
              </h1>
              <p className="max-w-prose text-[1.05rem] text-muted-foreground">
                {deckName === undefined ? (
                  "Every review you've made, in every deck."
                ) : (
                  <>
                    The reviews in <span className="font-medium text-foreground">{deckName}</span>.
                  </>
                )}
              </p>
            </div>
            <RangePills value={range} onChange={onRange} className="w-full sm:w-fit" />
          </div>
        </div>

        <Activity stats={stats} />

        <div className="gap-x-5 md:columns-2 lg:gap-x-6 [&>section]:mb-5 [&>section]:break-inside-avoid lg:[&>section]:mb-6">
          <Minutes stats={stats} />
          <Retention stats={stats} deck={deckName !== undefined} />
          <Stages stats={stats} />
          <Agreement stats={stats} />
        </div>
      </div>
    </Page>
  );
}

function Card({
  id,
  title,
  aside,
  children,
}: {
  id: string;
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={`${id}-title`}
      className="flex flex-col gap-5 rounded-[1.25rem] border bg-card p-5 text-card-foreground sm:p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 id={`${id}-title`} className="text-xl font-semibold tracking-tight">
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-xl bg-muted px-4 py-6 text-center text-sm text-muted-foreground">
      {children}
    </p>
  );
}

function Figure({ value, detail, big = false }: { value: string; detail: string; big?: boolean }) {
  return (
    <div className="-mt-2 flex flex-col gap-1">
      <span
        className={cn(
          "font-semibold tabular-nums",
          big ? "text-5xl tracking-[-0.03em] text-primary" : "text-3xl tracking-tight",
        )}
      >
        {value}
      </span>
      <span className="text-sm text-muted-foreground tabular-nums">{detail}</span>
    </div>
  );
}

/** Where the calendar's box is scrolled to, from the calendar's left edge. */
const scrolledFrom = (el: HTMLDivElement) =>
  el.scrollLeft - Number.parseFloat(getComputedStyle(el).paddingLeft);

function Activity({ stats }: { stats: Statistics }) {
  const total = stats.calendar.reduce((sum, d) => sum + d.reviews, 0);
  const scroller = useRef<HTMLDivElement>(null);
  const [labelsFrom, setLabelsFrom] = useState(0);
  // Opened at this week, once: picking a range leaves the calendar where it is.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el === null) return;
    el.scrollLeft = el.scrollWidth;
    setLabelsFrom(scrolledFrom(el));
  }, []);
  return (
    <Card id="activity" title="Activity" aside={<CalendarLegend />}>
      <p className="-mt-3 text-sm text-muted-foreground">
        The last 53 weeks, whatever the range: {reviewsLabel(total)} on {stats.calendar.length}{" "}
        {stats.calendar.length === 1 ? "day" : "days"}.
      </p>
      <div className="relative">
        {/* Below desktop the calendar scrolls sideways, opened at this week. */}
        <div
          ref={scroller}
          onScroll={(event) => setLabelsFrom(scrolledFrom(event.currentTarget))}
          className="-mx-5 overflow-x-auto px-5 py-2 [scrollbar-width:thin] sm:-mx-6 sm:px-6 lg:overflow-visible"
        >
          <ActivityCalendar stats={stats} labelsFrom={labelsFrom} className="w-max lg:hidden" />
          <ActivityCalendar stats={stats} fit className="hidden lg:block" />
        </div>
        {/* Over the box, not the calendar, so it stays in view however far that scrolls. */}
        {total === 0 ? (
          <p className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="rounded-full bg-card px-4 py-1.5 text-sm text-muted-foreground shadow-sm">
              No reviews in the last 53 weeks
            </span>
          </p>
        ) : null}
      </div>
    </Card>
  );
}

function Minutes({ stats }: { stats: Statistics }) {
  const { total, perDay } = minutesSummary(stats);
  return (
    <Card
      id="minutes"
      title={stats.minutes.bucket === "week" ? "Minutes per week" : "Minutes per day"}
    >
      <Figure
        value={minutesLabel(total)}
        detail={`${overRangeLabel(stats)} · ${minutesLabel(perDay)} a day`}
      />
      <MinutesBars stats={stats} className="pt-4" />
    </Card>
  );
}

function Retention({ stats, deck }: { stats: Statistics; deck: boolean }) {
  const { recalled, total, desiredRetention } = stats.actualRetention;
  const actual = total === 0 ? 0 : (recalled / total) * 100;
  // Compared as shown, to a tenth of a point, so the sentence agrees with the figures.
  const gap = Math.round(actual * 10) / 10 - Math.round(desiredRetention * 10) / 10;
  const towards = deck
    ? "this deck's Desired retention"
    : "the Desired retention your reviews were scheduled for";
  return (
    <Card id="retention" title="Actual retention">
      {total === 0 ? (
        <Empty>{NO_LEARNED}</Empty>
      ) : (
        <>
          <Figure
            big
            value={percentLabel(actual)}
            detail={`of ${reviewsLabel(total)} of learned cards recalled, ${overRangeLabel(stats)}`}
          />
          <RetentionTrack actual={actual} desired={desiredRetention} />
          <p className="text-sm text-muted-foreground">
            {Math.abs(gap) < 0.05
              ? `Right at ${towards}.`
              : `${gap > 0 ? "Above" : "Below"} ${towards} by ${Math.abs(gap).toFixed(1)} points.`}
          </p>
        </>
      )}
    </Card>
  );
}

function Stages({ stats }: { stats: Statistics }) {
  const total = stats.cards.new + stats.cards.learning + stats.cards.learned;
  return (
    <Card id="stages" title="Cards by stage">
      <p className="-mt-3 text-sm text-muted-foreground">
        Now, whatever the range: {total.toLocaleString("en-GB")} {total === 1 ? "card" : "cards"}.
      </p>
      <StageBar cards={stats.cards} />
      <ul className="flex flex-col divide-y">
        {STAGES.map((s) => (
          <li key={s.key} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
            <Swatch fill={s.fill} />
            <span className="flex-1">{s.label}</span>
            <span className="font-medium tabular-nums">
              {stats.cards[s.key].toLocaleString("en-GB")}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Agreement({ stats }: { stats: Statistics }) {
  const g = stats.graderAgreement;
  const total = gradedOf(g);
  return (
    <Card id="agreement" title="Grader agreement">
      {total === 0 ? (
        <Empty>{NO_GRADED}</Empty>
      ) : (
        <>
          <Figure
            value={`${percentLabel((g.kept / total) * 100, 0)} kept`}
            detail={`of ${reviewsLabel(total)} graded · ${g.higher} rated higher · ${g.lower} rated lower`}
          />
          <AgreementBar split={g} />
          <div aria-hidden className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {AGREEMENT.map((a) => (
              <span key={a.key} className="flex items-center gap-1.5">
                <Swatch fill={a.fill} />
                {a.label}
              </span>
            ))}
          </div>
          <ul className="flex flex-col divide-y border-t">
            {g.models.map((m) => {
              const n = gradedOf(m);
              return (
                <li key={m.model} className="flex flex-col gap-2 py-3 last:pb-0">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-medium break-all">{modelName(m.model)}</span>
                    <span className="shrink-0 text-sm tabular-nums">
                      <span className="font-medium">{percentLabel((m.kept / n) * 100, 0)}</span>
                      <span className="text-muted-foreground"> of {n}</span>
                    </span>
                  </div>
                  <AgreementBar split={m} className="h-1.5" />
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {m.higher} higher · {m.lower} lower
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Card>
  );
}
