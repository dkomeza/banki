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
  RangeTabs,
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
  longDay,
  statisticsOf,
  useStatisticsView,
} from "@/lib/statistics-proto";
import { cn } from "@/lib/utils";

// PROTOTYPE (BAN-53), Variant c, "Two halves": the page says which charts
// follow the range by where they sit. First what doesn't: the year's calendar
// and the Cards by stage now. Then the range, as tabs over a heading of its
// own, and the three charts it moves. Each card opens with a sentence that
// carries its figure.

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
  const deck = scope.kind === "deck";
  return (
    <Page width="cards">
      <div className="flex flex-col gap-10 lg:gap-14">
        <div className="flex flex-col gap-4">
          {breadcrumb}
          <h1 className="text-[2.25rem] leading-none font-semibold tracking-[-0.035em] lg:text-5xl">
            Statistics
          </h1>
          <p className="max-w-prose text-[1.05rem] text-muted-foreground">
            {deckName === undefined ? (
              "Every review you've made, in every deck, deleted cards' too."
            ) : (
              <>
                The reviews of <span className="font-medium text-foreground">{deckName}</span>,
                removed cards' too.
              </>
            )}
          </p>
        </div>

        <Half title="Your year" note="These don't follow the range.">
          <div className="flex flex-col gap-5 lg:gap-6">
            <Year stats={stats} state={state} />
            <Stages stats={stats} />
          </div>
        </Half>

        <Half
          title={range === "all" ? "All time" : `The last ${range} days`}
          note={`${rangeSpan(stats)}.`}
          tabs={<RangeTabs value={range} className="w-full sm:w-fit sm:border-b-0" />}
        >
          <Minutes stats={stats} />
          <div className="grid gap-5 md:grid-cols-2 lg:gap-6">
            <Retention stats={stats} deck={deck} />
            <Agreement stats={stats} />
          </div>
        </Half>
      </div>
    </Page>
  );
}

const rangeSpan = (stats: Statistics) =>
  stats.from === stats.to ? "Today" : `${longDay(stats.from)} to today`;

function Half({
  title,
  note,
  tabs,
  children,
}: {
  title: string;
  note: string;
  tabs?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-5 lg:gap-6">
      <div className="flex flex-col gap-3 border-b pb-3 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-2xl font-semibold tracking-tight lg:text-[1.75rem]">{title}</h2>
          <p className="text-sm text-muted-foreground">{note}</p>
        </div>
        {tabs === undefined ? null : <div className="-mb-3 sm:-mb-3">{tabs}</div>}
      </div>
      {children}
    </div>
  );
}

function Card({
  id,
  title,
  lead,
  className,
  children,
}: {
  id: string;
  title: string;
  lead?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className={cn(
        "flex flex-col gap-4 rounded-[1.25rem] border bg-card p-5 text-card-foreground sm:p-6",
        className,
      )}
    >
      <div className="flex flex-col gap-1.5">
        <h3 id={`${id}-title`} className="text-sm font-medium text-muted-foreground">
          {title}
        </h3>
        {lead === undefined ? null : (
          <p className="text-xl leading-snug font-medium tracking-tight text-pretty">{lead}</p>
        )}
      </div>
      {children}
    </section>
  );
}

const Figure = ({ children }: { children: ReactNode }) => (
  <span className="text-primary tabular-nums">{children}</span>
);

function Year({ stats, state }: { stats: Statistics; state: string | undefined }) {
  const total = stats.calendar.reduce((s, d) => s + d.reviews, 0);
  const busiest = stats.calendar.reduce<Statistics["calendar"][number] | undefined>(
    (best, d) => (best === undefined || d.reviews > best.reviews ? d : best),
    undefined,
  );
  return (
    <Card
      id="activity"
      title="Activity"
      lead={
        total === 0 ? (
          "No reviews in the last 53 weeks."
        ) : (
          <>
            <Figure>{reviewsLabel(total)}</Figure> on {stats.calendar.length} of the last 53 weeks'
            days.
          </>
        )
      }
    >
      {/* A phone stands the year up: a week a row, so every day stays big enough to tap. */}
      <div className="flex gap-5 md:hidden">
        <ActivityCalendar
          stats={stats}
          state={state}
          vertical
          cell={11}
          gap={3}
          className="shrink-0"
        />
        <div className="flex flex-col gap-4 pt-4 text-sm text-muted-foreground">
          <CalendarLegend />
          <p>A week a row, this week at the top. Tap a day to read it.</p>
          {busiest === undefined ? null : (
            <p>
              Busiest day: <span className="text-foreground">{longDay(busiest.day)}</span>,{" "}
              {reviewsLabel(busiest.reviews)}.
            </p>
          )}
        </div>
      </div>
      <div className="hidden flex-col gap-3 md:flex">
        <ActivityCalendar stats={stats} state={state} fit />
        <div className="flex items-center justify-between gap-4 text-sm text-muted-foreground">
          {busiest === undefined ? (
            <span />
          ) : (
            <span>
              Busiest day: <span className="text-foreground">{longDay(busiest.day)}</span>,{" "}
              {reviewsLabel(busiest.reviews)}
            </span>
          )}
          <CalendarLegend />
        </div>
      </div>
    </Card>
  );
}

function Stages({ stats }: { stats: Statistics }) {
  const total = stats.cards.new + stats.cards.learning + stats.cards.learned;
  return (
    <Card
      id="stages"
      title="Cards by stage"
      lead={
        <>
          <Figure>{stats.cards.learned}</Figure> of {total} cards learned.
        </>
      }
    >
      <StageBar stats={stats} />
      <ul className="flex flex-col gap-2 text-sm md:flex-row md:gap-8">
        {STAGES.map((s) => (
          <li key={s.key} className="flex items-center gap-2.5">
            <Swatch fill={s.fill} />
            <span className="flex-1 md:flex-none">{s.label}</span>
            <span className="font-medium tabular-nums">{stats.cards[s.key]}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Minutes({ stats }: { stats: Statistics }) {
  const { total, perDay } = minutesSummary(stats);
  return (
    <Card
      id="minutes"
      title={stats.minutes.bucket === "week" ? "Minutes per week" : "Minutes per day"}
      lead={
        total === 0 ? (
          "No study time in this range."
        ) : (
          <>
            <Figure>{minutesLabel(total)}</Figure> of study, about {Math.round(perDay / 60_000)} min
            a day
            {stats.range === "all" ? ` ${rangeLabel(stats)}` : ""}.
          </>
        )
      }
    >
      <MinutesBars stats={stats} height={150} className="pt-5" />
    </Card>
  );
}

function Retention({ stats, deck }: { stats: Statistics; deck: boolean }) {
  const r = retentionOf(stats);
  return (
    <Card
      id="retention"
      title="Actual retention"
      lead={
        r.total === 0 ? (
          `${NO_LEARNED}.`
        ) : (
          <>
            You recalled <Figure>{fmtPct(r.value)}</Figure> of {reviewsLabel(r.total)} of learned
            cards, {Math.abs(r.value - r.desired).toFixed(1)} points{" "}
            {r.value >= r.desired ? "over" : "under"} {deck ? "this deck's" : "your"} Desired
            retention.
          </>
        )
      }
    >
      {r.total === 0 ? null : (
        <>
          <RetentionTrack stats={stats} />
          {deck ? null : (
            <p className="text-xs text-muted-foreground">
              Desired retention here is the decks', weighted by how many of these reviews each had.
            </p>
          )}
        </>
      )}
    </Card>
  );
}

function Agreement({ stats }: { stats: Statistics }) {
  const g = stats.graderAgreement;
  const total = graded(g);
  return (
    <Card
      id="agreement"
      title="Grader agreement"
      lead={
        total === 0 ? (
          `${NO_GRADED}.`
        ) : (
          <>
            You kept the Grader's suggestion <Figure>{fmtPct((g.kept / total) * 100, 0)}</Figure> of
            the time: {g.higher} rated higher, {g.lower} lower.
          </>
        )
      }
    >
      {total === 0 ? null : (
        <>
          <AgreementBar split={g} />
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {AGREEMENT.map((a) => (
              <span key={a.key} className="flex items-center gap-1.5">
                <Swatch fill={a.fill} />
                {a.label}
              </span>
            ))}
          </div>
          <ul className="flex flex-col gap-3 border-t pt-4">
            {g.models.map((m) => {
              const n = graded(m);
              return (
                <li key={m.model} className="flex flex-col gap-1.5 text-sm">
                  <p>
                    <span className="font-medium">{modelName(m.model)}</span>
                    <span className="text-muted-foreground tabular-nums">
                      {" "}
                      · {fmtPct((m.kept / n) * 100, 0)} kept of {n} · {m.higher} higher · {m.lower}{" "}
                      lower
                    </span>
                  </p>
                  <AgreementBar split={m} className="h-1.5" />
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Card>
  );
}
