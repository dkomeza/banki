import type { Rating } from "@banki/shared";
import type { ReactNode } from "react";
import { Hand, LoaderCircle, RotateCcw, Sparkles } from "lucide-react";
import { OUTLINE_PILL } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import { dayLabel, timeLabel } from "@/lib/card-days";
import { type CardHistoryEntry, durationLabel, useCardHistory } from "@/lib/history-proto";
import { RATING_LABELS } from "@/lib/study";
import { cn } from "@/lib/utils";

// PROTOTYPE (BAN-52), Variant b: Diary. The history reads like the deck
// page's timeline, on the page itself rather than in a card: a run per day,
// its time in the margin, each entry hanging on a rail by a dot. A Rating
// is a tinted chip. A Progress reset is a node on the rail in the accent,
// and the rail runs dashed under it, through the Reviews it started over.

const at = (entry: CardHistoryEntry) =>
  entry.type === "review" ? entry.reviewedAt : entry.resetAt;

const CHIP: Record<Rating, string> = {
  again: "bg-destructive/12 text-destructive",
  hard: "bg-muted text-foreground ring-1 ring-border",
  good: "bg-foreground/8 text-foreground",
  easy: "bg-primary/14 text-primary",
};

const DOT: Record<Rating, string> = {
  again: "bg-destructive",
  hard: "bg-muted-foreground",
  good: "bg-foreground",
  easy: "bg-primary",
};

/** Entries already newest first, in runs of one day each. */
function byDay(entries: readonly CardHistoryEntry[]) {
  const days: { day: string; items: { entry: CardHistoryEntry; before: boolean }[] }[] = [];
  let before = false;
  for (const entry of entries) {
    const day = dayLabel(at(entry));
    const last = days.at(-1);
    const item = { entry, before };
    if (last?.day === day) last.items.push(item);
    else days.push({ day, items: [item] });
    if (entry.type === "progress-reset") before = true;
  }
  return days;
}

const TIME_COL = "w-12 shrink-0 sm:w-16";

export function CardHistory({ cardId }: { cardId: string }) {
  const history = useCardHistory(cardId);
  const entries = history.data?.entries;
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
          <span className="flex items-center gap-2 text-muted-foreground">
            <LoaderCircle aria-hidden className="size-4 animate-spin" />
            Loading history…
          </span>
        </Note>
      ) : history.isError ? (
        <Note>
          <span className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <span className="text-destructive">Couldn&rsquo;t load this card&rsquo;s history.</span>
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
      ) : entries === undefined || entries.length === 0 ? (
        <Note>
          <span className="text-muted-foreground">No reviews yet</span>
        </Note>
      ) : (
        byDay(entries).map(({ day, items }) => (
          <section key={day} aria-label={day}>
            <div className="flex gap-3 sm:gap-4">
              <span aria-hidden className={TIME_COL} />
              <h3
                className={cn(
                  "relative border-l pt-3 pb-2 pl-6 text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase sm:pl-8",
                  items[0]?.before && "border-dashed",
                )}
              >
                {day}
              </h3>
            </div>
            <ol>
              {items.map(({ entry, before }) => (
                <Entry key={entry.id} entry={entry} before={before} />
              ))}
            </ol>
          </section>
        ))
      )}
    </section>
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

function Entry({ entry, before }: { entry: CardHistoryEntry; before: boolean }) {
  const time = (
    <p className={cn(TIME_COL, "pt-2.5 text-right text-sm text-muted-foreground tabular-nums")}>
      {timeLabel(at(entry))}
    </p>
  );
  if (entry.type === "progress-reset") {
    return (
      <li className="flex gap-3 sm:gap-4">
        {time}
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
  const changed =
    entry.kind === "graded" &&
    entry.suggestedRating !== null &&
    entry.suggestedRating !== entry.rating;
  return (
    <li className="flex gap-3 sm:gap-4">
      {time}
      <div
        className={cn(
          "relative min-w-0 flex-1 border-l pb-3 pl-6 sm:pl-8",
          before && "border-dashed",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "absolute top-[1.05rem] -left-[0.3125rem] size-2.5 rounded-full ring-4 ring-background",
            DOT[entry.rating],
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
            {changed && entry.suggestedRating !== null && (
              <>
                {", suggested "}
                <span className="font-medium text-foreground">
                  {RATING_LABELS[entry.suggestedRating]}
                </span>
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
