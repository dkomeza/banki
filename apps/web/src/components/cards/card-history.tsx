import type { Rating } from "@banki/shared";
import { Hand, LoaderCircle, RotateCcw, Sparkles } from "lucide-react";
import { OUTLINE_PILL } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import { dayLabel, timeLabel } from "@/lib/card-days";
import { type CardHistoryEntry, durationLabel, useCardHistory } from "@/lib/history-proto";
import { RATING_LABELS } from "@/lib/study";
import { cn } from "@/lib/utils";

// PROTOTYPE (BAN-52), Variant f: a summary over the Diary. The section opens
// on a card laid out like the form above it, "History" in its label margin:
// what the Card has been through in counts, and Variant c's strip of every
// entry oldest to newest (a Review a bar as tall as its Rating, a Progress
// reset a break). Under the card, Variant b's timeline on the page: a run
// per day, its time in the margin, each entry hanging on a rail by a dot, a
// Rating as a tinted chip, a Progress reset an accent node with the rail
// dashed under it.

const at = (entry: CardHistoryEntry) =>
  entry.type === "review" ? entry.reviewedAt : entry.resetAt;

const CHIP: Record<Rating, string> = {
  again: "bg-destructive/12 text-destructive",
  hard: "bg-muted text-foreground ring-1 ring-border",
  good: "bg-foreground/8 text-foreground",
  easy: "bg-primary/14 text-primary",
};

/** A Review's dot on the rail and its bar in the strip. */
const DOT: Record<Rating, string> = {
  again: "bg-destructive",
  hard: "bg-foreground/40",
  good: "bg-foreground/75",
  easy: "bg-primary",
};

const LEVEL: Record<Rating, number> = { again: 1, hard: 2, good: 3, easy: 4 };

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

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

export function CardHistory({ cardId }: { cardId: string }) {
  const history = useCardHistory(cardId);
  const entries = history.data?.entries;
  return (
    <section aria-labelledby="history-title" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1 rounded-2xl border bg-card px-4 py-5 shadow-xs sm:flex-row sm:gap-6 sm:px-6 sm:py-6">
        <h2
          id="history-title"
          className="pt-1 text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase sm:w-16 sm:shrink-0 sm:pt-1.5 sm:text-right"
        >
          History
        </h2>
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          {history.isPending ? (
            <p className="flex items-center gap-2 pt-1 text-sm text-muted-foreground">
              <LoaderCircle aria-hidden className="size-4 animate-spin" />
              Loading history…
            </p>
          ) : history.isError ? (
            <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
              <p className="text-sm text-destructive">
                Couldn&rsquo;t load this card&rsquo;s history.
              </p>
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
            </div>
          ) : entries === undefined || entries.length === 0 ? (
            <p className="pt-1 text-sm text-muted-foreground">No reviews yet</p>
          ) : (
            <Summary entries={entries} />
          )}
        </div>
      </div>
      {entries !== undefined && entries.length > 0 && (
        <div>
          {byDay(entries).map(({ day, items }) => (
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
          ))}
        </div>
      )}
    </section>
  );
}

/** The Card's life in counts, over the strip. */
function Summary({ entries }: { entries: readonly CardHistoryEntry[] }) {
  if (entries.length === 0)
    return <p className="pt-1 text-sm text-muted-foreground">No reviews yet</p>;
  const reviews = entries.filter((e) => e.type === "review");
  const resets = entries.length - reviews.length;
  const lastReset = entries.findIndex((e) => e.type === "progress-reset");
  const since = lastReset === -1 ? reviews.length : lastReset;
  const graded = reviews.filter((r) => r.kind === "graded").length;
  const oldest = entries.at(-1)!;
  return (
    <>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:flex sm:flex-wrap sm:gap-x-10">
        <Stat label="Reviews" value={String(reviews.length)} />
        {resets > 0 && <Stat label="Since the reset" value={String(since)} />}
        <Stat label="Graded" value={`${graded} of ${reviews.length}`} />
        <Stat label="First" value={dayLabel(at(oldest))} />
      </dl>
      <Strip entries={entries} />
      {resets > 1 && (
        <p className="text-xs text-muted-foreground">{plural(resets, "Progress reset")}</p>
      )}
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-lg font-semibold tracking-tight tabular-nums">{value}</dd>
    </div>
  );
}

/** Every entry oldest to newest, as bars: a Review as tall as its Rating, a Progress reset a break. */
function Strip({ entries }: { entries: readonly CardHistoryEntry[] }) {
  const oldest = entries.at(-1);
  const newest = entries[0];
  // One entry is no picture: the counts and the timeline say it all.
  if (oldest === undefined || newest === undefined || entries.length < 2) return null;
  const from = dayLabel(at(oldest));
  const to = dayLabel(at(newest));
  return (
    <figure className="flex flex-col gap-1.5">
      <div aria-hidden className="flex h-12 items-end gap-1 border-b pb-px">
        {entries.toReversed().map((entry) =>
          entry.type === "review" ? (
            <span
              key={entry.id}
              className={cn("w-3 max-w-6 flex-1 rounded-t-[3px]", DOT[entry.rating])}
              style={{ height: `${LEVEL[entry.rating] * 25}%` }}
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
