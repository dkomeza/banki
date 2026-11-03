import { DEFAULT_DAY_START_HOUR } from "@banki/shared";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Play } from "lucide-react";
import { OUTLINE_PILL, PILL } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import { settingsQueryOptions } from "@/lib/settings";
import {
  type StudyOverview,
  estimateLabel,
  nextDueLabel,
  nothingToStudy,
  studyOverviewQueryOptions,
  todayOf,
} from "@/lib/study-overview";
import { cn } from "@/lib/utils";

// What Study will bring, on the deck page: a small card holding the Cards
// today, large in the accent, with `12 due · 20 new · ~9 min` as its caption,
// and the Study pill closing the row (under it, full width, on phones).
// Nothing to study says so in the figure's place, with when the next Cards
// come, and the pill is disabled.

/** The deck page's Study card, from the Deck's overview, refetched each time the page shows. */
export function StudyCard({ deckId }: { deckId: string }) {
  const overview = useQuery({ ...studyOverviewQueryOptions(deckId), refetchOnMount: "always" });
  const settings = useQuery(settingsQueryOptions()).data?.settings;
  const today = todayOf({
    timezone: settings?.timezone ?? null,
    dayStartHour: settings?.dayStartHour ?? DEFAULT_DAY_START_HOUR,
  });
  return <StudyCardView deckId={deckId} overview={overview.data ?? undefined} today={today} />;
}

/**
 * The Study card for `overview`; while it loads (or when it can't), just the
 * Study pill. `today` is the User's Study day, to word the next due day.
 * Exported for its tests.
 */
export function StudyCardView({
  deckId,
  overview,
  today,
}: {
  deckId: string;
  overview: StudyOverview | undefined;
  today: string;
}) {
  const nothing = overview !== undefined && nothingToStudy(overview);
  const next = overview === undefined ? undefined : nextDueLabel(overview.nextDue, today);
  return (
    <section
      aria-label="Study"
      className="flex flex-col gap-4 rounded-2xl border bg-card p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:px-5"
    >
      {overview === undefined ? (
        // Holds the figure's height, so the page doesn't move when it arrives.
        <div aria-hidden className="hidden h-10 sm:block" />
      ) : nothing ? (
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="text-lg font-semibold tracking-[-0.01em]">Nothing to study</p>
          {next !== undefined && (
            <p className="text-sm text-muted-foreground tabular-nums">Next {next}</p>
          )}
        </div>
      ) : (
        <div className="flex min-w-0 items-center gap-4">
          <span className="text-4xl leading-none font-semibold tracking-[-0.04em] text-primary tabular-nums">
            {overview.due + overview.new}
          </span>
          <div className="flex flex-col gap-0.5">
            <p className="font-semibold">
              {overview.due + overview.new === 1 ? "card" : "cards"} today
            </p>
            <p className="text-sm text-muted-foreground tabular-nums">
              {overview.due} due · {overview.new} new · {estimateLabel(overview.estimateMs)}
            </p>
          </div>
        </div>
      )}
      {nothing ? (
        <Button variant="outline" className={cn(OUTLINE_PILL, "h-11 w-full sm:w-auto")} disabled>
          <Play aria-hidden />
          Study
        </Button>
      ) : (
        <Button
          className={cn(PILL, "h-11 w-full px-7 text-primary-foreground no-underline sm:w-auto")}
          render={<Link to="/decks/$deckId/study" params={{ deckId }} />}
          nativeButton={false}
        >
          <Play aria-hidden />
          Study
        </Button>
      )}
    </section>
  );
}
