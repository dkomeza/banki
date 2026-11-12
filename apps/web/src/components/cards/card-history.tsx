import type { Rating } from "@banki/shared";
import { LoaderCircle, RotateCcw } from "lucide-react";
import { Fragment } from "react";
import { OUTLINE_PILL } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import { dayLabel, timeLabel } from "@/lib/card-days";
import { type CardHistoryEntry, durationLabel, useCardHistory } from "@/lib/history-proto";
import { RATING_LABELS } from "@/lib/study";
import { cn } from "@/lib/utils";

// PROTOTYPE (BAN-52), Variant c: Strip. The history is a card laid out like
// the form above it, "History" in its label margin. A strip of bars, oldest
// to newest, shows the Card's whole life at a glance: each Review a bar as
// tall as its Rating, each Progress reset a break. Under it, the entries
// newest first, in runs split by the Progress resets ("Since the reset",
// "Before the reset"), each run with its count. A Rating is its word with
// four pips, as many filled as the Rating is high.

type Review = Extract<CardHistoryEntry, { type: "review" }>;
type Reset = Extract<CardHistoryEntry, { type: "progress-reset" }>;

const LEVEL: Record<Rating, number> = { again: 1, hard: 2, good: 3, easy: 4 };

const BAR: Record<Rating, string> = {
  again: "bg-destructive",
  hard: "bg-foreground/40",
  good: "bg-foreground/75",
  easy: "bg-primary",
};

const when = (e: CardHistoryEntry) => (e.type === "review" ? e.reviewedAt : e.resetAt);
const at = (iso: string) => `${dayLabel(iso)}, ${timeLabel(iso)}`;
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** Newest first, in runs that each end at a Progress reset (the one that started them). */
function runs(entries: readonly CardHistoryEntry[]) {
  const out: { reviews: Review[]; startedBy?: Reset }[] = [{ reviews: [] }];
  for (const entry of entries) {
    const run = out.at(-1)!;
    if (entry.type === "review") run.reviews.push(entry);
    else {
      run.startedBy = entry;
      out.push({ reviews: [] });
    }
  }
  return out;
}

export function CardHistory({ cardId }: { cardId: string }) {
  const history = useCardHistory(cardId);
  const entries = history.data?.entries;
  return (
    <section
      aria-labelledby="history-title"
      className="flex flex-col gap-1 rounded-2xl border bg-card px-4 py-6 shadow-xs sm:flex-row sm:gap-6 sm:px-6 sm:py-7"
    >
      <h2
        id="history-title"
        className="pt-1 text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase sm:w-16 sm:shrink-0 sm:pt-1.5 sm:text-right"
      >
        History
      </h2>
      <div className="flex min-w-0 flex-1 flex-col gap-5">
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
          <>
            <Strip entries={entries} />
            <Runs entries={entries} />
          </>
        )}
      </div>
    </section>
  );
}

/** Every entry oldest to newest, as bars: a Review as tall as its Rating, a Progress reset a break. */
function Strip({ entries }: { entries: readonly CardHistoryEntry[] }) {
  const oldest = entries.at(-1);
  const newest = entries[0];
  // One entry is no picture: the list says it all.
  if (oldest === undefined || newest === undefined || entries.length < 2) return null;
  const from = dayLabel(when(oldest));
  const to = dayLabel(when(newest));
  return (
    <figure className="flex flex-col gap-1.5">
      <div aria-hidden className="flex h-12 items-end gap-1 border-b pb-px">
        {entries.toReversed().map((entry) =>
          entry.type === "review" ? (
            <span
              key={entry.id}
              className={cn("w-3 max-w-6 flex-1 rounded-t-[3px]", BAR[entry.rating])}
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

function Runs({ entries }: { entries: readonly CardHistoryEntry[] }) {
  const all = runs(entries);
  const split = all.length > 1;
  return (
    <div className="flex flex-col gap-5">
      {all.map((run, i) => (
        <Fragment key={run.startedBy?.id ?? "first"}>
          {(split || run.reviews.length > 0) && (
            <div className="flex flex-col">
              {split && (
                <h3 className="flex items-baseline justify-between gap-3 pb-1 text-sm">
                  <span className="font-semibold">
                    {i === 0
                      ? "Since the reset"
                      : i === all.length - 1
                        ? "Before the reset"
                        : "Between resets"}
                  </span>
                  <span className="text-muted-foreground tabular-nums">
                    {plural(run.reviews.length, "review")}
                  </span>
                </h3>
              )}
              {run.reviews.length === 0 ? (
                <p className="border-t py-3 text-sm text-muted-foreground">None since</p>
              ) : (
                <ol className={cn(i > 0 && "text-muted-foreground")}>
                  {run.reviews.map((review) => (
                    <ReviewRow key={review.id} review={review} />
                  ))}
                </ol>
              )}
            </div>
          )}
          {run.startedBy !== undefined && (
            <p className="-my-1 flex items-center gap-2 rounded-full bg-primary/8 px-3 py-1.5 text-sm text-primary">
              <RotateCcw aria-hidden className="size-3.5 shrink-0" />
              <span className="font-semibold">Progress reset</span>
              <span className="ml-auto text-muted-foreground tabular-nums">
                {at(run.startedBy.resetAt)}
              </span>
            </p>
          )}
        </Fragment>
      ))}
    </div>
  );
}

function Pips({ rating }: { rating: Rating }) {
  return (
    <span aria-hidden className="flex gap-0.5">
      {[1, 2, 3, 4].map((n) => (
        <span
          key={n}
          className={cn("h-3 w-1.5 rounded-[2px]", n <= LEVEL[rating] ? BAR[rating] : "bg-border")}
        />
      ))}
    </span>
  );
}

function ReviewRow({ review }: { review: Review }) {
  const changed =
    review.kind === "graded" &&
    review.suggestedRating !== null &&
    review.suggestedRating !== review.rating;
  return (
    <li className="grid grid-cols-[1fr_auto] items-baseline gap-x-4 gap-y-0.5 border-t py-2.5 sm:grid-cols-[9rem_7rem_1fr_auto]">
      <span className="col-span-2 text-sm tabular-nums sm:col-span-1">{at(review.reviewedAt)}</span>
      <span className="flex items-center gap-2 font-semibold text-foreground">
        <Pips rating={review.rating} />
        <span className={cn(review.rating === "again" && "text-destructive")}>
          {RATING_LABELS[review.rating]}
        </span>
      </span>
      <span className="row-start-3 text-sm sm:row-start-auto">
        {review.kind === "graded" ? "Graded" : "Self-rated"}
        {changed && review.suggestedRating !== null && (
          <span className="text-muted-foreground">
            {" "}
            · suggested {RATING_LABELS[review.suggestedRating]}
          </span>
        )}
      </span>
      <span className="row-start-2 col-start-2 text-right text-sm text-muted-foreground tabular-nums sm:row-start-auto sm:col-start-auto">
        {durationLabel(review.durationMs)}
      </span>
    </li>
  );
}
