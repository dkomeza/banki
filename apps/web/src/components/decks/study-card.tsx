import { DEFAULT_DAY_START_HOUR } from "@banki/shared";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Play } from "lucide-react";
import { OUTLINE_PILL, PILL } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import { openProgress } from "@/lib/session-store";
import { settingsQueryOptions } from "@/lib/settings";
import {
  FRESH,
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
// come, and the pill is disabled. With an open Session (ADR-0027) the pill
// reads Continue, and the counts are what resuming it brings; one with only
// New cards held back by its batch says they are waiting, and Continue
// opens its end, which offers another batch.

/**
 * The deck page's Study card, from the Deck's overview for its open Session
 * (or a fresh one), refetched each time the page shows.
 */
export function StudyCard({ deckId }: { deckId: string }) {
  const settings = useQuery(settingsQueryOptions()).data?.settings;
  const open = openProgress(deckId, settings?.sessionTimeoutMinutes);
  const overview = useQuery({
    ...studyOverviewQueryOptions(deckId, open ?? FRESH),
    refetchOnMount: "always",
  });
  const today = todayOf({
    timezone: settings?.timezone ?? null,
    dayStartHour: settings?.dayStartHour ?? DEFAULT_DAY_START_HOUR,
  });
  return (
    <StudyCardView
      deckId={deckId}
      overview={overview.data ?? undefined}
      today={today}
      resuming={open !== undefined}
    />
  );
}

/** "Nothing due · 37 new waiting": an open Session with only New cards held back by its batch. */
export const waitingLabel = (newTotal: number) => `Nothing due · ${newTotal} new waiting`;

/**
 * The Study card for `overview`; while it loads (or when it can't), just the
 * Study pill. `today` is the User's Study day, to word the next due day.
 * `resuming` is whether the Deck has an open Session. Exported for its tests.
 */
export function StudyCardView({
  deckId,
  overview,
  today,
  resuming = false,
}: {
  deckId: string;
  overview: StudyOverview | undefined;
  today: string;
  resuming?: boolean;
}) {
  const empty = overview !== undefined && nothingToStudy(overview);
  // New cards held back by the open Session's batch: its end offers another.
  const waiting = empty && resuming && overview.newTotal > 0;
  const nothing = empty && !waiting;
  // Nothing at all to study, the pill is as without an open Session.
  const label = resuming ? "Continue" : "Study";
  const next = overview === undefined ? undefined : nextDueLabel(overview.nextDue, today);
  return (
    <section
      aria-label="Study"
      className="flex flex-col gap-4 rounded-2xl border bg-card p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:px-5"
    >
      {overview === undefined ? (
        // Holds the figure's height, so the page doesn't move when it arrives.
        <div aria-hidden className="hidden h-10 sm:block" />
      ) : empty ? (
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="text-lg font-semibold tracking-[-0.01em] tabular-nums">
            {waiting ? waitingLabel(overview.newTotal) : "Nothing to study"}
          </p>
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
          {label}
        </Button>
      )}
    </section>
  );
}
