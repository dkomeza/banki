import type { Rating } from "@banki/shared";
import { type ReactNode, useLayoutEffect, useRef } from "react";
import { Hand, LoaderCircle, RotateCcw, Sparkles } from "lucide-react";
import { OUTLINE_PILL } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import { dayLabel, timeLabel } from "@/lib/card-days";
import { type CardHistoryEntry, durationLabel, useCardHistory } from "@/lib/history-proto";
import { RATING_LABELS } from "@/lib/study";
import { cn } from "@/lib/utils";

// PROTOTYPE (BAN-52), Variant e: Diary, indexed by the strip. Variant b's
// timeline (a run per day, its time in the margin, each entry hanging on a
// rail by a dot, a Rating as a tinted chip, a Progress reset an accent node
// with the rail dashed under it), headed by Variant c's strip, split into
// the same days: each day a cluster of bars under its short date, a Review
// as tall as its Rating, a Progress reset a break. A day's cluster is a link
// to its run in the timeline, which lights up its heading when it lands.

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

/** A day's anchor in the timeline. */
const dayId = (day: string) => `history-${day.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}`;

/** "13 Oct" for "Tue 13 Oct"; Today and Yesterday as they are. */
const shortDay = (day: string) => (day.includes(" ") ? day.slice(day.indexOf(" ") + 1) : day);

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
        <>
          <Strip days={byDay(entries).toReversed()} />
          {byDay(entries).map(({ day, items }) => (
            <section key={day} id={dayId(day)} aria-label={day} className="group/day scroll-mt-6">
              <div className="flex gap-3 sm:gap-4">
                <span aria-hidden className={TIME_COL} />
                <h3
                  className={cn(
                    "relative border-l pt-3 pb-2 pl-6 text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase transition-colors group-target/day:text-primary sm:pl-8",
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
        </>
      )}
    </section>
  );
}

/**
 * The days oldest to newest, each a cluster of bars, a Review as tall as its
 * Rating and a Progress reset a break, that links to the day in the timeline.
 */
function Strip({ days }: { days: ReturnType<typeof byDay> }) {
  const strip = useRef<HTMLElement>(null);
  // Many days run past the edge: open at the newest (the strip mounts with its data).
  useLayoutEffect(() => {
    const el = strip.current;
    if (el !== null) el.scrollLeft = el.scrollWidth;
  }, []);
  // One entry is no picture: the timeline says it all.
  if (days.reduce((n, { items }) => n + items.length, 0) < 2) return null;
  return (
    <div className="flex gap-3 sm:gap-4">
      <span aria-hidden className={TIME_COL} />
      <nav
        ref={strip}
        aria-label="Days"
        className="flex min-w-0 flex-1 items-end gap-0.5 overflow-x-auto border-l pt-1 pb-3 pl-4 [scrollbar-width:none] sm:gap-2 sm:pl-6"
      >
        {days.map(({ day, items }) => (
          <a
            key={day}
            href={`#${dayId(day)}`}
            className="group flex shrink-0 flex-col items-center gap-1.5 rounded-lg px-1 sm:min-w-11 sm:px-1.5 pt-1.5 pb-1 outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span aria-hidden className="flex h-12 items-end gap-1">
              {items.toReversed().map(({ entry }) =>
                entry.type === "review" ? (
                  <span
                    key={entry.id}
                    className={cn("w-2.5 rounded-t-[3px] sm:w-3", DOT[entry.rating])}
                    style={{ height: `${LEVEL[entry.rating] * 25}%` }}
                  />
                ) : (
                  <span
                    key={entry.id}
                    className="mx-1 flex h-full flex-col items-center justify-between text-primary"
                  >
                    <RotateCcw className="size-3" />
                    <span className="w-px flex-1 border-l border-dashed border-primary" />
                  </span>
                ),
              )}
            </span>
            <span className="w-full border-t pt-1 text-center text-[0.7rem] whitespace-nowrap text-muted-foreground group-hover:text-foreground">
              <span className="sr-only">{day}</span>
              <span aria-hidden>{shortDay(day)}</span>
            </span>
          </a>
        ))}
      </nav>
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
