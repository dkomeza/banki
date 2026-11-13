import type { CardHistoryEntry, Rating } from "@banki/shared";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Hand, LoaderCircle, RotateCcw, Sparkles } from "lucide-react";
import { OUTLINE_PILL } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import { dayLabel, timeLabel } from "@/lib/card-days";
import {
  RATING_LEVEL,
  changedSuggestion,
  durationLabel,
  entryAt,
  historyByDay,
} from "@/lib/card-history";
import { cardHistoryQueryOptions } from "@/lib/cards";
import { RATING_LABELS } from "@/lib/study";
import { cn } from "@/lib/utils";

// The edit page's History, under the form: a Card's Reviews and Progress
// resets, newest first, on a rail like the deck page's timeline. Each day's
// entries run under its heading, each with its time in the margin and hanging
// on the rail by a dot in its Rating's colour; a Progress reset is an accent
// box on the rail, which runs dashed under it, past the entries before it.
// A strip of bars heads the rail: every entry oldest to newest, a Review as
// tall as its Rating, a Progress reset a break, in the dots' colours.
// Read-only, and loaded beside the form, which never waits for it.

/** A Rating's chip. */
const CHIP: Record<Rating, string> = {
  again: "bg-destructive/12 text-destructive",
  hard: "bg-muted text-foreground ring-1 ring-border",
  good: "bg-foreground/8 text-foreground",
  easy: "bg-primary/10 text-primary",
};

/** A Review's dot on the rail and its bar in the strip. */
const MARK: Record<Rating, string> = {
  again: "bg-destructive",
  hard: "bg-foreground/40",
  good: "bg-foreground/75",
  easy: "bg-primary",
};

/** The margin the times sit in, left of the rail. */
const TIME_COL = "w-12 shrink-0 sm:w-16";

/** The History of the Card `cardId`, fetched fresh each time the page opens. */
export function CardHistory({ cardId }: { cardId: string }) {
  const history = useQuery({ ...cardHistoryQueryOptions(cardId), refetchOnMount: "always" });
  return (
    <section aria-labelledby="history-title" className="flex flex-col pt-4">
      <div className="flex gap-3 sm:gap-4">
        <span aria-hidden className={TIME_COL} />
        <h2 id="history-title" className="pb-2 pl-6 text-2xl font-semibold tracking-tight sm:pl-8">
          History
        </h2>
      </div>
      {history.isPending ? (
        <Note>
          <span role="status" className="flex items-center gap-2 text-muted-foreground">
            <LoaderCircle aria-hidden className="size-4 animate-spin" />
            Loading history…
          </span>
        </Note>
      ) : history.isError ? (
        <Note>
          <span className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <span role="alert" className="text-destructive">
              Couldn&rsquo;t load this card&rsquo;s history.
            </span>
            <Button
              type="button"
              variant="outline"
              className={cn(OUTLINE_PILL, "h-11 lg:h-9")}
              disabled={history.isFetching}
              onClick={() => void history.refetch()}
            >
              {history.isFetching && <LoaderCircle aria-hidden className="animate-spin" />}
              Try again
            </Button>
          </span>
        </Note>
      ) : history.data.length === 0 ? (
        <Note>
          <span className="text-muted-foreground">No reviews yet</span>
        </Note>
      ) : (
        <Timeline entries={history.data} />
      )}
    </section>
  );
}

function Timeline({ entries }: { entries: readonly CardHistoryEntry[] }) {
  return (
    <>
      <Strip entries={entries} />
      {historyByDay(entries).map(({ day, items }, n) => (
        // A day can come twice, when a clock stepped back.
        <section key={`${n}-${day}`} aria-label={day}>
          <div className="flex gap-3 sm:gap-4">
            <span aria-hidden className={TIME_COL} />
            <h3
              className={cn(
                "border-l pt-3 pb-2 pl-6 text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase sm:pl-8",
                items[0]?.beforeReset && "border-dashed",
              )}
            >
              {day}
            </h3>
          </div>
          <ol>
            {items.map(({ entry, beforeReset }) =>
              entry.type === "review" ? (
                <ReviewEntry key={entry.id} entry={entry} beforeReset={beforeReset} />
              ) : (
                <ResetEntry key={entry.id} at={entry.resetAt} />
              ),
            )}
          </ol>
        </section>
      ))}
    </>
  );
}

/** Every entry oldest to newest, as bars: a Review as tall as its Rating, a Progress reset a break. */
function Strip({ entries }: { entries: readonly CardHistoryEntry[] }) {
  const newest = entries[0];
  const oldest = entries.at(-1);
  // One entry is no picture: the timeline says it all.
  if (newest === undefined || oldest === undefined || entries.length < 2) return null;
  const from = dayLabel(entryAt(oldest));
  const to = dayLabel(entryAt(newest));
  return (
    <div className="flex gap-3 sm:gap-4">
      <span aria-hidden className={TIME_COL} />
      <figure className="flex min-w-0 flex-1 flex-col gap-1.5 border-l pt-1 pb-3 pl-6 sm:pl-8">
        <div aria-hidden className="flex h-12 items-end gap-1 border-b pb-px">
          {entries.toReversed().map((entry) =>
            entry.type === "review" ? (
              <span
                key={entry.id}
                className={cn("w-3 max-w-6 flex-1 rounded-t-[3px]", MARK[entry.rating])}
                style={{ height: `${RATING_LEVEL[entry.rating] * 25}%` }}
              />
            ) : (
              <span
                key={entry.id}
                className="mx-1.5 flex h-full flex-col items-center justify-between text-primary"
              >
                <RotateCcw className="size-3" />
                <span className="w-px flex-1 border-l border-dashed border-primary" />
              </span>
            ),
          )}
        </div>
        <figcaption className="flex justify-between gap-3 text-xs text-muted-foreground">
          <span>{from}</span>
          {to !== from && <span>{to}</span>}
        </figcaption>
      </figure>
    </div>
  );
}

function Note({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-3 sm:gap-4">
      <span aria-hidden className={TIME_COL} />
      <p className="border-l py-3 pl-6 text-sm sm:pl-8">{children}</p>
    </div>
  );
}

function Time({ at }: { at: string }) {
  return (
    <p className={cn(TIME_COL, "pt-2.5 text-right text-sm text-muted-foreground tabular-nums")}>
      {timeLabel(at)}
    </p>
  );
}

function ResetEntry({ at }: { at: string }) {
  return (
    <li className="flex gap-3 sm:gap-4">
      <Time at={at} />
      <div className="relative min-w-0 flex-1 border-l border-dashed pb-3 pl-6 sm:pl-8">
        <span
          aria-hidden
          className="absolute top-[1.05rem] -left-[0.3125rem] size-2.5 rotate-45 bg-primary ring-4 ring-background"
        />
        <div className="flex flex-col rounded-xl border border-primary/40 bg-primary/6 px-4 py-2.5">
          <span className="flex items-center gap-2 text-sm font-semibold text-primary">
            <RotateCcw aria-hidden className="size-3.5" />
            Progress reset
          </span>
          <span className="text-[0.8rem] text-muted-foreground">
            Started over as New. The reviews below came before.
          </span>
        </div>
      </div>
    </li>
  );
}

function ReviewEntry({
  entry,
  beforeReset,
}: {
  entry: Extract<CardHistoryEntry, { type: "review" }>;
  beforeReset: boolean;
}) {
  const suggested = changedSuggestion(entry);
  return (
    <li className="flex gap-3 sm:gap-4">
      <Time at={entry.reviewedAt} />
      <div
        className={cn(
          "relative min-w-0 flex-1 border-l pb-3 pl-6 sm:pl-8",
          beforeReset && "border-dashed",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "absolute top-[1.05rem] -left-[0.3125rem] size-2.5 rounded-full ring-4 ring-background",
            MARK[entry.rating],
          )}
        />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5">
          <span
            className={cn(
              "inline-flex h-7 items-center rounded-full px-3 text-sm font-semibold",
              CHIP[entry.rating],
            )}
          >
            {RATING_LABELS[entry.rating]}
          </span>
          <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
            {entry.kind === "graded" ? (
              <Sparkles aria-hidden className="size-3.5" />
            ) : (
              <Hand aria-hidden className="size-3.5" />
            )}
            {entry.kind === "graded" ? "Graded" : "Self-rated"}
            {suggested !== undefined && (
              <>
                {", suggested "}
                <span className="font-medium text-foreground">{RATING_LABELS[suggested]}</span>
              </>
            )}
          </span>
          <span className="ml-auto text-sm text-muted-foreground tabular-nums">
            {durationLabel(entry.durationMs)}
          </span>
        </div>
      </div>
    </li>
  );
}
