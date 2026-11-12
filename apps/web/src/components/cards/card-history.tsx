import type { Rating } from "@banki/shared";
import { LoaderCircle, RotateCcw } from "lucide-react";
import { OUTLINE_PILL } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import { dayLabel, timeLabel } from "@/lib/card-days";
import { type CardHistoryEntry, durationLabel, useCardHistory } from "@/lib/history-proto";
import { RATING_LABELS } from "@/lib/study";
import { cn } from "@/lib/utils";

// PROTOTYPE (BAN-52), Variant a: Ledger. The history is a second bordered
// card under the form, one flat row per entry, newest first, its moments in
// the same margin the form's labels use. A Progress reset is a full-width
// rule in the accent, and everything under it is dimmed: it came before.

const at = (iso: string) => `${dayLabel(iso)}, ${timeLabel(iso)}`;

/** Again is the one Rating in the danger colour; Easy takes the accent. */
const MARK: Record<Rating, string> = {
  again: "bg-destructive",
  hard: "bg-foreground/45",
  good: "bg-foreground",
  easy: "bg-primary",
};

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

export function CardHistory({ cardId }: { cardId: string }) {
  const history = useCardHistory(cardId);
  const entries = history.data?.entries;
  const reviews = entries?.filter((e) => e.type === "review").length ?? 0;
  const resets = (entries?.length ?? 0) - reviews;
  const resetAt = entries?.findIndex((e) => e.type === "progress-reset") ?? -1;
  return (
    <section
      aria-labelledby="history-title"
      className="flex flex-col gap-4 rounded-2xl border bg-card px-4 py-6 shadow-xs sm:px-6 sm:py-7"
    >
      <div className="flex items-baseline justify-between gap-3 sm:pl-22">
        <h2 id="history-title" className="text-xl font-semibold tracking-tight">
          History
        </h2>
        {entries !== undefined && entries.length > 0 && (
          <p className="text-sm text-muted-foreground tabular-nums">
            {plural(reviews, "review")}
            {resets > 0 && ` · ${plural(resets, "reset")}`}
          </p>
        )}
      </div>
      {history.isPending ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground sm:pl-22">
          <LoaderCircle aria-hidden className="size-4 animate-spin" />
          Loading history…
        </p>
      ) : history.isError ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl bg-muted px-4 py-3 sm:ml-22">
          <p className="min-w-0 flex-1 text-sm text-destructive">
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
        <p className="text-sm text-muted-foreground sm:pl-22">No reviews yet</p>
      ) : (
        <ol className="flex flex-col">
          {entries.map((entry, i) => (
            <Entry
              key={entry.id}
              entry={entry}
              before={resetAt !== -1 && i > resetAt}
              first={i === 0 || i === resetAt + 1}
            />
          ))}
        </ol>
      )}
    </section>
  );
}

function Entry({
  entry,
  before,
  first,
}: {
  entry: CardHistoryEntry;
  before: boolean;
  first: boolean;
}) {
  if (entry.type === "progress-reset") {
    return (
      <li className="my-2 flex items-center gap-3 border-y border-primary/40 bg-primary/6 py-2.5 sm:gap-6 -mx-4 px-4 sm:-mx-6 sm:px-6">
        <p className="hidden w-16 shrink-0 text-right text-xs text-muted-foreground tabular-nums sm:block">
          {timeLabel(entry.resetAt)}
        </p>
        <RotateCcw aria-hidden className="size-4 shrink-0 text-primary" />
        <p className="min-w-0 flex-1 text-sm">
          <span className="font-semibold text-primary">Progress reset</span>
          <span className="text-muted-foreground">
            {" "}
            · {dayLabel(entry.resetAt)}
            <span className="sm:hidden">, {timeLabel(entry.resetAt)}</span>
          </span>
        </p>
        <p className="hidden text-xs text-muted-foreground md:block">Earlier reviews below</p>
      </li>
    );
  }
  const changed =
    entry.kind === "graded" &&
    entry.suggestedRating !== null &&
    entry.suggestedRating !== entry.rating;
  return (
    <li
      className={cn(
        "flex gap-3 py-3 sm:gap-6",
        !first && "border-t",
        before && "text-muted-foreground",
      )}
    >
      {/* The moment, in the form's label margin from 640 px. */}
      <div className="hidden w-16 shrink-0 flex-col items-end pt-0.5 text-right sm:flex">
        <span className="text-xs leading-tight font-medium whitespace-nowrap">
          {dayLabel(entry.reviewedAt)}
        </span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {timeLabel(entry.reviewedAt)}
        </span>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden
            className={cn(
              "size-2.5 shrink-0 rounded-[3px]",
              MARK[entry.rating],
              before && "opacity-50",
            )}
          />
          <span
            className={cn(
              "font-semibold",
              entry.rating === "again" && !before && "text-destructive",
            )}
          >
            {RATING_LABELS[entry.rating]}
          </span>
          <span
            className={cn(
              "rounded-full border px-2 py-px text-xs",
              entry.kind === "graded"
                ? "border-foreground/25"
                : "border-dashed text-muted-foreground",
            )}
          >
            {entry.kind === "graded" ? "Graded" : "Self-rated"}
          </span>
          <span className="ml-auto text-sm text-muted-foreground tabular-nums">
            {durationLabel(entry.durationMs)}
          </span>
        </div>
        {changed && entry.suggestedRating !== null && (
          <p className="pl-5 text-sm text-muted-foreground">
            The Grader suggested{" "}
            <span className="font-medium text-foreground">
              {RATING_LABELS[entry.suggestedRating]}
            </span>
          </p>
        )}
        <p className="pl-5 text-sm text-muted-foreground sm:hidden">{at(entry.reviewedAt)}</p>
      </div>
    </li>
  );
}
