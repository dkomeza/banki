import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Plus, Search, Trash2, X } from "lucide-react";
import { TileMenu } from "@/components/tile-menu";
import { byDay, timeLabel } from "@/lib/card-days";
import type { Card } from "@/lib/cards";
import { cn } from "@/lib/utils";
import { deckTags, highlight, matches, useCardTags, useDeckFilter, wordsOf } from "@/proto/tags";
import { deleteWithUndo } from "./card-toasts";

// The deck page's Cards, written over days, hang on a timeline: grouped under
// the day each was written, its time in the margin, each Card a bordered card
// on the card colour hung on the rail by a short tick. The newest one's dot
// and border are in the accent. New card is the timeline's first entry.

/** The timeline's geometry: the time column, then the rail with its dots. */
export const TIME_COL = "w-12 shrink-0 sm:w-14";
export const RAIL = "relative border-l border-border pl-6 sm:pl-8";
export const DOT =
  "absolute top-[0.55rem] -left-[0.3rem] size-2.5 rounded-full ring-4 ring-background";

/** A side's first line, cut short, to name a Card by. */
export const firstLine = (side: string) => {
  const line = side.trim().split("\n")[0] ?? "";
  return line.length > 80 ? `${line.slice(0, 80)}…` : line;
};

/** One Card on the timeline, opening its edit page, with Delete in its ⋯ menu. */
function Entry({
  card,
  newest,
  words,
  picked,
  onTag,
}: {
  card: Card;
  newest: boolean;
  words: readonly string[];
  picked: readonly string[];
  onTag: (tag: string) => void;
}) {
  const queryClient = useQueryClient();
  const tags = useCardTags(card.id);
  return (
    <li className="group/tile relative flex gap-3 sm:gap-4">
      <p
        className={cn(
          TIME_COL,
          "pt-[0.95rem] text-right text-sm text-muted-foreground tabular-nums",
        )}
      >
        {timeLabel(card.createdAt)}
      </p>
      <div className={cn(RAIL, "min-w-0 flex-1 pb-4")}>
        <span
          aria-hidden
          className={cn(DOT, "top-[1.15rem]", newest ? "bg-primary" : "bg-input")}
        />
        {/* A short tick from the rail to the card, so the card hangs on the line. */}
        <span aria-hidden className="absolute top-[1.45rem] left-0 h-px w-6 bg-border sm:w-8" />
        <div
          className={cn(
            "rounded-xl border bg-card shadow-xs transition-colors has-[a:hover]:border-input",
            newest && "border-primary/40 has-[a:hover]:border-primary/60",
          )}
        >
          <Link
            to="/cards/$cardId"
            params={{ cardId: card.id }}
            className="flex flex-col gap-1 rounded-xl px-4 py-3 pr-14 no-underline outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid sm:px-5 sm:py-3.5"
          >
            <p className="text-[1.1rem] leading-snug font-semibold tracking-tight whitespace-pre-wrap text-foreground [overflow-wrap:anywhere]">
              <Marked text={card.front} words={words} />
            </p>
            <p className="line-clamp-6 leading-relaxed whitespace-pre-wrap text-muted-foreground [overflow-wrap:anywhere]">
              <Marked text={card.back} words={words} />
            </p>
          </Link>
          {tags.length > 0 && (
            <ul aria-label="Tags" className="-mt-1 flex flex-wrap gap-1 px-3 pb-3 sm:px-4">
              {tags.map((tag) => (
                <li key={tag}>
                  <button
                    type="button"
                    aria-pressed={picked.includes(tag)}
                    title={picked.includes(tag) ? `Stop filtering by ` : `Show only `}
                    onClick={() => onTag(tag)}
                    className="inline-flex h-8 items-center rounded-full px-2 text-[0.8rem] font-medium text-muted-foreground hover:bg-muted hover:text-foreground aria-pressed:bg-primary/12 aria-pressed:text-primary lg:h-6"
                  >
                    <span aria-hidden className="text-muted-foreground/60">
                      #
                    </span>
                    {tag}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <TileMenu
          label="Card actions"
          className="absolute top-1.5 right-1.5 shadow-none sm:top-2 sm:right-2"
          actions={[
            {
              label: "Delete",
              icon: <Trash2 aria-hidden />,
              danger: true,
              onClick: () => void deleteWithUndo(queryClient, card),
            },
          ]}
        />
      </div>
    </li>
  );
}

/** The timeline's first entry: New card; with no Cards, the empty state under it. */
function NewEntry({ deckId, empty }: { deckId: string; empty: boolean }) {
  return (
    <div className="flex gap-3 sm:gap-4">
      <span aria-hidden className={TIME_COL} />
      <div className={cn(RAIL, "flex-1 pb-8", empty && "border-dashed")}>
        <span
          aria-hidden
          className="absolute top-2.5 -left-[0.7rem] flex size-[1.35rem] items-center justify-center rounded-full bg-primary text-primary-foreground ring-4 ring-background"
        >
          <Plus className="size-3.5" strokeWidth={2.75} />
        </span>
        <Link
          to="/decks/$deckId/cards/new"
          params={{ deckId }}
          className="inline-flex h-11 items-center gap-1.5 rounded-full border border-dashed border-input px-5 text-sm font-medium text-foreground no-underline hover:border-solid hover:border-primary hover:bg-accent lg:h-10"
        >
          New card
        </Link>
        {empty && (
          <div className="flex flex-col gap-1 pt-6">
            <p className="text-lg font-medium">Nothing written yet</p>
            <p className="max-w-xs text-sm text-balance text-muted-foreground">
              Each Card you write goes on this line under the day you wrote it, newest at the top.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/** Text with the runs matching the search marked. */
function Marked({ text, words }: { text: string; words: readonly string[] }) {
  return highlight(text, words).map((run, i) =>
    run.hit ? (
      <mark key={i} className="rounded-[0.2em] bg-primary/18 text-inherit">
        {run.text}
      </mark>
    ) : (
      run.text
    ),
  );
}

/**
 * Variant a: the search and the deck's Tags in one bar that sticks to the top
 * of the screen as the list scrolls: a search field, then every Tag as a chip
 * with its count, in one row that scrolls sideways.
 */
function FilterBar({
  cards,
  filter,
}: {
  cards: readonly Card[];
  filter: ReturnType<typeof useDeckFilter>;
}) {
  const tags = deckTags(cards);
  return (
    <div className="sticky top-0 z-20 -mx-5 flex flex-col gap-2.5 border-b border-transparent bg-background/92 px-5 pt-3 pb-3 backdrop-blur sm:mx-0 sm:px-0">
      <div className="relative max-w-3xl">
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <input
          type="search"
          aria-label="Search cards"
          placeholder="Search fronts and backs"
          value={filter.q}
          onChange={(event) => filter.setQ(event.target.value)}
          className="h-11 w-full rounded-full border border-input bg-card pr-11 pl-10 text-base outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring focus-visible:outline-solid lg:h-10 lg:text-sm [&::-webkit-search-cancel-button]:hidden"
        />
        {filter.q !== "" && (
          <button
            type="button"
            aria-label="Clear the search"
            onClick={() => filter.setQ("")}
            className="absolute top-1/2 right-1 flex size-11 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:text-foreground lg:size-8 lg:right-1.5"
          >
            <X className="size-4" aria-hidden />
          </button>
        )}
      </div>
      <div
        role="group"
        aria-label="Filter by tag"
        className="-mx-5 flex gap-1.5 overflow-x-auto px-5 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0"
      >
        {tags.map(({ tag, count }) => {
          const on = filter.picked.includes(tag);
          return (
            <button
              key={tag}
              type="button"
              aria-pressed={on}
              onClick={() => filter.toggle(tag)}
              className={cn(
                "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition-colors lg:h-8",
                on
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-foreground hover:border-input hover:bg-muted",
              )}
            >
              {tag}
              <span
                className={cn(
                  "text-xs tabular-nums",
                  on ? "text-primary-foreground/80" : "text-muted-foreground",
                )}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** The deck page's Cards section: its live Cards on a timeline by day, newest first. */
export function CardTimeline({ deckId, cards }: { deckId: string; cards: readonly Card[] }) {
  const filter = useDeckFilter();
  const words = wordsOf(filter.q);
  const shown = cards.filter((card) => matches(card, words, filter.picked));
  return (
    <section aria-labelledby="cards-title" className="flex flex-col gap-3 border-t pt-6 lg:pt-8">
      <h2 id="cards-title" className="text-xl font-semibold tracking-tight">
        Cards{" "}
        {cards.length > 0 && (
          <span className="font-normal text-muted-foreground tabular-nums">
            {filter.active ? `${shown.length} of ${cards.length}` : cards.length}
          </span>
        )}
      </h2>
      {cards.length > 0 && <FilterBar cards={cards} filter={filter} />}
      <div className="max-w-3xl pt-3">
        <NewEntry deckId={deckId} empty={cards.length === 0} />
        {cards.length > 0 && shown.length === 0 && (
          <div className="flex gap-3 sm:gap-4">
            <span aria-hidden className={TIME_COL} />
            <div className={cn(RAIL, "flex-1 border-dashed pb-8")}>
              <p className="text-lg font-medium">No cards match</p>
              <p className="max-w-sm pt-1 text-sm text-muted-foreground">
                Nothing in this deck has every word
                {filter.picked.length > 0 ? " and every picked tag" : ""}.
              </p>
              <button
                type="button"
                onClick={filter.clear}
                className="mt-4 inline-flex h-11 items-center rounded-full border border-input px-5 text-sm font-medium hover:bg-muted lg:h-10"
              >
                Clear
              </button>
            </div>
          </div>
        )}
        {byDay(shown).map(({ day, items }, i) => (
          <section key={day} aria-label={day}>
            <div className="flex gap-3 sm:gap-4">
              <span aria-hidden className={TIME_COL} />
              <h3
                className={cn(
                  RAIL,
                  "pt-3 pb-3 text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase",
                )}
              >
                {day}
              </h3>
            </div>
            <ol>
              {items.map((card, j) => (
                <Entry
                  key={card.id}
                  card={card}
                  newest={!filter.active && i === 0 && j === 0}
                  words={words}
                  picked={filter.picked}
                  onTag={filter.toggle}
                />
              ))}
            </ol>
          </section>
        ))}
      </div>
    </section>
  );
}
