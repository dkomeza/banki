import type { ReactNode } from "react";
import { Page } from "@/components/page";
import {
  AGREEMENT,
  ActivityCalendar,
  AgreementBar,
  CalendarLegend,
  MinutesBars,
  NO_GRADED,
  NO_LEARNED,
  RangePills,
  RetentionTrack,
  STAGES,
  StageBar,
  Swatch,
  fmtPct,
  graded,
  minutesLabel,
  minutesSummary,
  modelName,
  rangeLabel,
  retentionOf,
  reviewsLabel,
} from "@/components/statistics/charts";
import {
  type Scope,
  type Statistics,
  type StatisticsSearch,
  statisticsOf,
  useStatisticsView,
} from "@/lib/statistics-proto";
import { cn } from "@/lib/utils";

// PROTOTYPE (BAN-53), Variant a, "Desk": the page as docs/design.md builds a
// page of cards. The year's activity comes first, full width, then the four
// range charts in masonry. The range is a row of pills beside the title.

export function StatisticsView({
  scope,
  search,
  deckName,
  breadcrumb,
}: {
  scope: Scope;
  search: StatisticsSearch;
  deckName?: string;
  breadcrumb?: ReactNode;
}) {
  const { range, state } = useStatisticsView(search);
  const stats = statisticsOf(scope, range, state);
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
            <RangePills value={range} className="w-full sm:w-fit" />
          </div>
        </div>

        <Card id="activity" title="Activity" aside={<CalendarLegend />}>
          <p className="-mt-3 text-sm text-muted-foreground">
            The last 53 weeks, whatever the range:{" "}
            {reviewsLabel(stats.calendar.reduce((s, d) => s + d.reviews, 0))} on{" "}
            {stats.calendar.length} days.
          </p>
          <div
            ref={(el) => {
              if (el !== null) el.scrollLeft = el.scrollWidth;
            }}
            className="-mx-5 overflow-x-auto px-5 py-2 [scrollbar-width:thin] sm:-mx-6 sm:px-6 lg:overflow-visible"
          >
            <ActivityCalendar stats={stats} state={state} className="w-max lg:hidden" />
            <ActivityCalendar stats={stats} state={state} fit className="hidden lg:block" />
          </div>
        </Card>

        <div className="gap-x-5 md:columns-2 lg:gap-x-6 [&>section]:mb-5 [&>section]:break-inside-avoid lg:[&>section]:mb-6">
          <Minutes stats={stats} />
          <Retention stats={stats} deck={scope.kind === "deck"} />
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
  className,
  children,
}: {
  id: string;
  title: string;
  aside?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className={cn(
        "flex flex-col gap-5 rounded-[1.25rem] border bg-card p-5 text-card-foreground sm:p-6",
        className,
      )}
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

function Minutes({ stats }: { stats: Statistics }) {
  const { total, perDay } = minutesSummary(stats);
  return (
    <Card
      id="minutes"
      title={stats.minutes.bucket === "week" ? "Minutes per week" : "Minutes per day"}
    >
      <div className="-mt-2 flex flex-col gap-1">
        <span className="text-3xl font-semibold tracking-tight tabular-nums">
          {minutesLabel(total)}
        </span>
        <span className="text-sm text-muted-foreground tabular-nums">
          {stats.range === "all" ? "" : "over "}
          {rangeLabel(stats)} · {Math.round(perDay / 60_000)} min a day
        </span>
      </div>
      <MinutesBars stats={stats} className="pt-4" />
    </Card>
  );
}

function Retention({ stats, deck }: { stats: Statistics; deck: boolean }) {
  const r = retentionOf(stats);
  return (
    <Card id="retention" title="Actual retention">
      {r.total === 0 ? (
        <Empty>{NO_LEARNED}</Empty>
      ) : (
        <>
          <div className="-mt-2 flex flex-col gap-1">
            <span className="text-5xl font-semibold tracking-[-0.03em] text-primary tabular-nums">
              {fmtPct(r.value)}
            </span>
            <span className="text-sm text-muted-foreground tabular-nums">
              of {reviewsLabel(r.total)} of learned cards recalled,{" "}
              {stats.range === "all" ? "" : "over "}
              {rangeLabel(stats)}
            </span>
          </div>
          <RetentionTrack stats={stats} />
          <p className="text-sm text-muted-foreground">
            {r.value >= r.desired ? "Above" : "Below"}{" "}
            {deck
              ? "this deck's Desired retention"
              : "the Desired retention your reviews were scheduled for"}{" "}
            by {Math.abs(r.value - r.desired).toFixed(1)} points.
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
      <p className="-mt-3 text-sm text-muted-foreground">Now, whatever the range: {total} cards.</p>
      <StageBar stats={stats} />
      <ul className="flex flex-col divide-y">
        {STAGES.map((s) => (
          <li key={s.key} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
            <Swatch fill={s.fill} />
            <span className="flex-1">{s.label}</span>
            <span className="font-medium tabular-nums">{stats.cards[s.key]}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Agreement({ stats }: { stats: Statistics }) {
  const g = stats.graderAgreement;
  const total = graded(g);
  return (
    <Card id="agreement" title="Grader agreement">
      {total === 0 ? (
        <Empty>{NO_GRADED}</Empty>
      ) : (
        <>
          <div className="-mt-2 flex flex-col gap-1">
            <span className="text-3xl font-semibold tracking-tight tabular-nums">
              {fmtPct((g.kept / total) * 100, 0)} kept
            </span>
            <span className="text-sm text-muted-foreground tabular-nums">
              of {reviewsLabel(total)} graded · {g.higher} rated higher · {g.lower} rated lower
            </span>
          </div>
          <AgreementBar split={g} />
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {AGREEMENT.map((a) => (
              <span key={a.key} className="flex items-center gap-1.5">
                <Swatch fill={a.fill} />
                {a.label}
              </span>
            ))}
          </div>
          <ul className="flex flex-col divide-y border-t">
            {g.models.map((m) => {
              const n = graded(m);
              return (
                <li key={m.model} className="flex flex-col gap-2 py-3 last:pb-0">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-medium">{modelName(m.model)}</span>
                    <span className="text-sm tabular-nums">
                      <span className="font-medium">{fmtPct((m.kept / n) * 100, 0)}</span>
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
