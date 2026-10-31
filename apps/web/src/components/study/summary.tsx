import { DEFAULT_DAY_START_HOUR } from "@banki/shared";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { LoaderCircle } from "lucide-react";
import { OUTLINE_PILL, PILL } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import type { Deck } from "@/lib/decks";
import { moreOffer } from "@/lib/new-cards";
import { settingsQueryOptions } from "@/lib/settings";
import { type SessionSummary, recallPercent, spentLabel } from "@/lib/study";
import {
  type StudyOverview,
  nextDueLabel,
  studyOverviewQueryOptions,
  todayOf,
} from "@/lib/study-overview";
import { cn } from "@/lib/utils";

// The summary at the end of a Session, or on leaving one with a Rating
// standing ("Headline"): one figure, very large in the accent, the Recall
// rate (or, in a Session without review Cards, the Cards studied), the other
// figures in a smaller row under it, then one sentence on what comes next.
// The actions dock to the bottom, stacked on phones, the main one on top.

/** The summary, with the Deck's overview fetched afresh as it shows. */
export function Summary({
  deck,
  summary,
  left,
  newHeld,
  loadingMore,
  onMore,
  onResume,
}: {
  deck: Deck;
  summary: SessionSummary;
  /** Left early (Keep studying), rather than at the end of the Queue. */
  left: boolean;
  newHeld: number;
  loadingMore: boolean;
  onMore: () => void;
  onResume: () => void;
}) {
  const overview = useQuery({
    ...studyOverviewQueryOptions(deck.id),
    refetchOnMount: "always",
  });
  const settings = useQuery(settingsQueryOptions()).data?.settings;
  return (
    <SummaryView
      deck={deck}
      summary={summary}
      left={left}
      // Only a fresh answer: a cached one is from before the Session.
      overview={overview.isFetchedAfterMount ? (overview.data ?? undefined) : undefined}
      today={todayOf({
        timezone: settings?.timezone ?? null,
        dayStartHour: settings?.dayStartHour ?? DEFAULT_DAY_START_HOUR,
      })}
      offer={left ? undefined : moreOffer(newHeld, settings?.newCardBatch)}
      loadingMore={loadingMore}
      onMore={onMore}
      onResume={onResume}
    />
  );
}

/**
 * What comes next, as the summary's sentence says it: left early with Cards
 * still to study, how many; else the next due day, or that none is. Undefined
 * until the overview is in.
 */
export function nextLine(
  overview: StudyOverview | undefined,
  { left, today }: { left: boolean; today: string },
): string | undefined {
  if (overview === undefined) return undefined;
  const still = overview.due + overview.new;
  if (left && still > 0) return `${still} still to study.`;
  const next = nextDueLabel(overview.nextDue, today);
  return next === undefined ? "Nothing scheduled." : `Next: ${next}.`;
}

/** The summary for its figures. Exported for its tests. */
export function SummaryView({
  deck,
  summary,
  left,
  overview,
  today,
  offer,
  loadingMore,
  onMore,
  onResume,
}: {
  deck: Deck;
  summary: SessionSummary;
  left: boolean;
  overview: StudyOverview | undefined;
  today: string;
  offer: { waiting: string; action: string } | undefined;
  loadingMore: boolean;
  onMore: () => void;
  onResume: () => void;
}) {
  const allNew = summary.newStudied === summary.studied;
  const hero =
    summary.recall === null
      ? {
          value: String(summary.studied),
          label: `${allNew ? "new " : ""}${summary.studied === 1 ? "card" : "cards"} ${allNew ? "learned" : "studied"}`,
          detail: allNew ? undefined : `${summary.newStudied} new`,
        }
      : {
          value: `${recallPercent(summary.recall)}%`,
          label: "recall rate",
          detail: `${summary.recall.kept} of ${summary.recall.of} review cards recalled`,
        };
  const others = [
    ...(summary.recall === null
      ? []
      : [
          {
            key: "cards",
            value: String(summary.studied),
            label: `${summary.studied === 1 ? "card" : "cards"} · ${summary.newStudied} new`,
          },
        ]),
    { key: "time", value: spentLabel(summary.timeMs), label: "spent" },
  ];
  const next = nextLine(overview, { left, today });
  const primary = left
    ? { label: "Keep studying", onClick: onResume, busy: false }
    : offer !== undefined
      ? { label: offer.action, onClick: onMore, busy: loadingMore }
      : undefined;
  return (
    <>
      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center gap-8 px-6 pt-6 pb-10 text-center">
        <h1 className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
          {left ? "Session paused" : "Session done"}
        </h1>
        <div className="flex flex-col items-center gap-2">
          <span className="text-[5.5rem] leading-none font-semibold tracking-[-0.05em] text-primary tabular-nums lg:text-[7rem]">
            {hero.value}
          </span>
          <span className="text-lg font-medium">{hero.label}</span>
          {hero.detail !== undefined && (
            <span className="text-sm text-muted-foreground tabular-nums">{hero.detail}</span>
          )}
        </div>
        <dl className="flex gap-10 border-t pt-6">
          {others.map((figure) => (
            <div key={figure.key} className="flex flex-col items-center">
              <dt className="sr-only">{figure.label}</dt>
              <dd className="text-2xl font-semibold tracking-[-0.02em] tabular-nums">
                {figure.value}
              </dd>
              <dd aria-hidden className="text-sm text-muted-foreground tabular-nums">
                {figure.label}
              </dd>
            </div>
          ))}
        </dl>
        <p className="min-h-7 text-balance text-lg tabular-nums">
          {next}
          {offer !== undefined && <span className="text-muted-foreground"> {offer.waiting}</span>}
        </p>
      </div>
      <div className="sticky bottom-0 z-10 bg-background/95 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
        <div className="mx-auto flex w-full max-w-md flex-col gap-2 px-4 pt-3 sm:flex-row-reverse">
          {primary !== undefined && (
            <Button
              className={cn(PILL, "h-14 text-base tabular-nums sm:flex-1 lg:h-12")}
              disabled={primary.busy}
              onClick={primary.onClick}
            >
              {primary.busy && (
                <LoaderCircle
                  aria-hidden
                  className="size-4 animate-spin motion-reduce:animate-none"
                />
              )}
              {primary.label}
            </Button>
          )}
          <Button
            variant={primary === undefined ? "default" : "outline"}
            className={cn(
              primary === undefined ? PILL : OUTLINE_PILL,
              "h-14 text-base no-underline sm:flex-1 lg:h-12",
              primary === undefined ? "text-primary-foreground" : "text-foreground",
            )}
            render={<Link to="/decks/$deckId" params={{ deckId: deck.id }} />}
            nativeButton={false}
          >
            Back to deck
          </Button>
        </div>
      </div>
    </>
  );
}
