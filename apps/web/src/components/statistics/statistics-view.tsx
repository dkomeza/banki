import type { ReactNode } from "react";
import { Page } from "@/components/page";
import { type Section, SectionIndex } from "@/components/settings/section-index";
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
import { useHiddenScrollbar } from "@/lib/use-hidden-scrollbar";
import { cn } from "@/lib/utils";

// PROTOTYPE (BAN-53), Variant b, "Figures first": the range's three figures
// open the page as tiles, under a range bar that stays at the top while the
// page scrolls. The charts follow full width, one under another, with a
// section index from 1024 px. The year's calendar comes after the range's
// charts, since the range doesn't move it.

const SECTIONS: readonly Section[] = [
  { id: "figures", title: "At a glance" },
  { id: "minutes", title: "Minutes" },
  { id: "activity", title: "Activity" },
  { id: "stages", title: "Cards by stage" },
  { id: "agreement", title: "Grader agreement" },
];

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
  useHiddenScrollbar();
  return (
    <Page width="cards">
      <div className="lg:grid lg:grid-cols-[2rem_minmax(0,1fr)] lg:gap-8">
        <SectionIndex label="Statistics sections" sections={SECTIONS} />
        <div className="flex flex-col gap-6 lg:gap-8">
          <div className="flex flex-col gap-4">
            {breadcrumb}
            <h1 className="text-[2.25rem] leading-none font-semibold tracking-[-0.035em] lg:text-5xl">
              Statistics
            </h1>
            {deckName !== undefined ? (
              <p className="text-[1.05rem] text-muted-foreground">
                For <span className="font-medium text-foreground">{deckName}</span>.
              </p>
            ) : null}
          </div>

          <div className="sticky top-[env(safe-area-inset-top)] z-20 -mx-5 flex items-center justify-between gap-4 border-b bg-background/95 px-5 py-2.5 backdrop-blur sm:-mx-8 sm:px-8 lg:mx-0 lg:rounded-full lg:border lg:px-2 lg:py-1.5">
            <RangePills
              value={range}
              className="w-full border-0 bg-transparent p-0 sm:w-fit dark:bg-transparent"
            />
            <span className="hidden pr-3 text-sm text-muted-foreground tabular-nums sm:block">
              {rangeSpan(stats)}
            </span>
          </div>

          <Figures stats={stats} deck={scope.kind === "deck"} />

          <Card
            id="minutes"
            title={stats.minutes.bucket === "week" ? "Minutes per week" : "Minutes per day"}
          >
            <MinutesBars stats={stats} height={200} barColor="var(--primary)" className="pt-5" />
          </Card>

          <Card
            id="activity"
            title="Activity"
            note="The last 53 weeks, whatever the range"
            aside={<CalendarLegend />}
          >
            <ActivityCalendar
              stats={stats}
              state={state}
              cell={5}
              gap={1.5}
              fit
              className="sm:hidden"
            />
            <ActivityCalendar stats={stats} state={state} fit className="hidden sm:block" />
          </Card>

          <div className="grid gap-6 md:grid-cols-2 lg:gap-8">
            <Stages stats={stats} />
            <Agreement stats={stats} />
          </div>
        </div>
      </div>
    </Page>
  );
}

const SPAN = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
function rangeSpan(stats: Statistics) {
  const [y, m, d] = stats.from.split("-").map(Number);
  const from = SPAN.format(new Date(y ?? 2000, (m ?? 1) - 1, d ?? 1, 12));
  return stats.from === stats.to ? "Today" : `${from} – today`;
}

function Card({
  id,
  title,
  note,
  aside,
  className,
  children,
}: {
  id: string;
  title: string;
  note?: string;
  aside?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className={cn(
        "flex scroll-mt-24 flex-col gap-4 rounded-[1.25rem] border bg-card p-5 text-card-foreground sm:p-6",
        className,
      )}
    >
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="flex flex-col gap-0.5">
          <h2 id={`${id}-title`} className="text-xl font-semibold tracking-tight">
            {title}
          </h2>
          {note === undefined ? null : <p className="text-sm text-muted-foreground">{note}</p>}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Figures({ stats, deck }: { stats: Statistics; deck: boolean }) {
  const r = retentionOf(stats);
  const { total, perDay } = minutesSummary(stats);
  const g = stats.graderAgreement;
  const gradedTotal = graded(g);
  const reviews = stats.calendar
    .filter((d) => d.day >= stats.from)
    .reduce((s, d) => s + d.reviews, 0);
  return (
    <section
      id="figures"
      aria-label="At a glance"
      className="grid scroll-mt-24 grid-cols-2 gap-3 lg:grid-cols-3 lg:gap-4"
    >
      <div className="flex flex-col gap-4 col-span-2 rounded-[1.25rem] border bg-card p-5 sm:p-6 lg:col-span-1 lg:row-span-2">
        <h2 className="text-sm font-medium text-muted-foreground">Actual retention</h2>
        {r.total === 0 ? (
          <p className="flex flex-1 items-center text-[1.05rem] text-muted-foreground">
            {NO_LEARNED}
          </p>
        ) : (
          <>
            <p className="text-6xl leading-none font-semibold tracking-[-0.04em] text-primary tabular-nums">
              {fmtPct(r.value)}
            </p>
            <p className="text-sm text-muted-foreground tabular-nums">
              {r.recalled.toLocaleString("en-GB")} of {reviewsLabel(r.total)} of learned cards
              recalled
            </p>
            <RetentionTrack stats={stats} className="mt-auto" />
            <p className="text-sm text-muted-foreground">
              {Math.abs(r.value - r.desired).toFixed(1)} points{" "}
              {r.value >= r.desired ? "over" : "under"}{" "}
              {deck
                ? "this deck’s Desired retention."
                : "the Desired retention of the decks you reviewed, weighted by review."}
            </p>
          </>
        )}
      </div>
      <Tile
        label="Studied"
        value={minutesLabel(total)}
        note={`${Math.round(perDay / 60_000)} min a day, ${rangeLabel(stats)}`}
      />
      <Tile label="Reviews" value={reviews.toLocaleString("en-GB")} note={rangeLabel(stats)} />
      <Tile
        className="col-span-2"
        label="Grader agreement"
        value={gradedTotal === 0 ? "—" : fmtPct((g.kept / gradedTotal) * 100, 0)}
        note={gradedTotal === 0 ? NO_GRADED : `kept of ${reviewsLabel(gradedTotal)} graded`}
      />
    </section>
  );
}

function Tile({
  label,
  value,
  note,
  className,
}: {
  label: string;
  value: string;
  note: string;
  className?: string;
}) {
  return (
    <div
      className={cn("flex flex-col gap-2 rounded-[1.25rem] border bg-card p-5 sm:p-6", className)}
    >
      <h2 className="text-sm font-medium text-muted-foreground">{label}</h2>
      <p className="text-2xl leading-none font-semibold tracking-tight tabular-nums sm:text-3xl">
        {value}
      </p>
      <p className="text-sm text-muted-foreground tabular-nums first-letter:uppercase">{note}</p>
    </div>
  );
}

function Stages({ stats }: { stats: Statistics }) {
  const total = stats.cards.new + stats.cards.learning + stats.cards.learned;
  return (
    <Card id="stages" title="Cards by stage" note={`${total} cards now, whatever the range`}>
      <div className="grid grid-cols-3 gap-2">
        {STAGES.map((s) => (
          <div key={s.key} className="flex flex-col gap-1 rounded-xl bg-muted p-3">
            <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Swatch fill={s.fill} />
              {s.label}
            </span>
            <span className="text-2xl font-semibold tabular-nums">{stats.cards[s.key]}</span>
          </div>
        ))}
      </div>
      <StageBar stats={stats} />
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
      note="Your Rating against the Grader's suggestion"
    >
      {total === 0 ? (
        <p className="rounded-xl bg-muted px-4 py-6 text-center text-sm text-muted-foreground">
          {NO_GRADED}
        </p>
      ) : (
        <table className="w-full text-sm tabular-nums">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="pb-2 font-normal">Model</th>
              {AGREEMENT.map((a) => (
                <th key={a.key} className="pb-2 text-right font-normal">
                  <span className="inline-flex items-center gap-1">
                    <Swatch fill={a.fill} />
                    {a.key === "kept" ? "Kept" : a.key === "higher" ? "Higher" : "Lower"}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y border-t">
            {[{ model: "All", ...g }, ...g.models].map((m) => {
              const n = graded(m);
              return (
                <tr key={m.model} className={cn(m.model === "All" && "font-medium")}>
                  <td className="py-2.5 pr-2">
                    <div className="flex flex-col gap-1.5">
                      <span>{m.model === "All" ? "Every model" : modelName(m.model)}</span>
                      <AgreementBar split={m} className="h-1.5 max-w-40" />
                    </div>
                  </td>
                  <td className="py-2.5 text-right">{fmtPct((m.kept / n) * 100, 0)}</td>
                  <td className="py-2.5 text-right">{m.higher}</td>
                  <td className="py-2.5 text-right">{m.lower}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Card>
  );
}
