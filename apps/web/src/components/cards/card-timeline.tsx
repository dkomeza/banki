import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Check, ChevronDown, Plus, Search, Tag, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { TileMenu } from "@/components/tile-menu";
import { byDay, dayLabel, timeLabel } from "@/lib/card-days";
import type { Card } from "@/lib/cards";
import { cn } from "@/lib/utils";
import { deckTags, matches, useCardTags, useDeckFilter, wordsOf } from "@/proto/tags";
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
function Entry({ card, newest, flat }: { card: Card; newest: boolean; flat: boolean }) {
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
        {flat ? (
          <>
            <span className="block">{dayLabel(card.createdAt).replace(/^\w+ /, "")}</span>
            <span className="block text-xs">{timeLabel(card.createdAt)}</span>
          </>
        ) : (
          timeLabel(card.createdAt)
        )}
      </p>
      <div className={cn(RAIL, "min-w-0 flex-1 pb-4")}>
        <span
          aria-hidden
          className={cn(DOT, "top-[1.15rem]", newest ? "bg-primary" : "bg-input")}
        />
        {/* A short tick from the rail to the card, so the card hangs on the line. */}
        <span aria-hidden className="absolute top-[1.45rem] left-0 h-px w-6 bg-border sm:w-8" />
        <Link
          to="/cards/$cardId"
          params={{ cardId: card.id }}
          className={cn(
            "flex flex-col gap-1 rounded-xl border bg-card px-4 py-3 pr-14 no-underline shadow-xs outline-none transition-colors hover:border-input focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid sm:px-5 sm:py-3.5",
            newest && "border-primary/40 hover:border-primary/60",
          )}
        >
          <p className="text-[1.1rem] leading-snug font-semibold tracking-tight whitespace-pre-wrap text-foreground [overflow-wrap:anywhere]">
            {card.front}
          </p>
          <p className="line-clamp-6 leading-relaxed whitespace-pre-wrap text-muted-foreground [overflow-wrap:anywhere]">
            {card.back}
          </p>
          {tags.length > 0 && (
            <p className="flex flex-wrap gap-1 pt-1.5">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground"
                >
                  #{tag}
                </span>
              ))}
            </p>
          )}
        </Link>
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

type Filter = ReturnType<typeof useDeckFilter>;

/**
 * Variant b: the Tags behind a menu beside the search, a searchable list with
 * a check and a count on each, like Banki's other pickers.
 */
function TagMenu({ cards, filter }: { cards: readonly Card[]; filter: Filter }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  const tags = deckTags(cards).filter(({ tag }) => tag.includes(query.trim().toLowerCase()));
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={cn(
          "inline-flex h-11 items-center gap-2 rounded-full border px-4 text-sm font-medium lg:h-10",
          filter.picked.length > 0
            ? "border-primary bg-primary/10 text-primary"
            : "border-input bg-card hover:bg-muted",
        )}
      >
        <Tag aria-hidden className="size-4" />
        Tags
        {filter.picked.length > 0 && (
          <span className="flex size-5 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground tabular-nums">
            {filter.picked.length}
          </span>
        )}
        <ChevronDown aria-hidden className="size-4 opacity-60" />
      </button>
      {open && (
        <div className="absolute top-full right-0 z-30 mt-2 w-64 rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-xl">
          <input
            aria-label="Find a tag"
            placeholder="Find a tag"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="mb-1 h-10 w-full rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring"
          />
          <ul className="max-h-72 overflow-y-auto">
            {tags.map(({ tag, count }) => {
              const on = filter.picked.includes(tag);
              return (
                <li key={tag}>
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() => filter.toggle(tag)}
                    className="flex min-h-11 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[0.95rem] hover:bg-accent lg:min-h-9"
                  >
                    <span
                      className={cn(
                        "flex size-4 items-center justify-center rounded border",
                        on ? "border-primary bg-primary text-primary-foreground" : "border-input",
                      )}
                    >
                      {on && <Check className="size-3" strokeWidth={3} aria-hidden />}
                    </span>
                    <span className="flex-1">{tag}</span>
                    <span className="text-sm text-muted-foreground tabular-nums">{count}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

/** The deck page's Cards section: its live Cards on a timeline by day, newest first. */
export function CardTimeline({ deckId, cards }: { deckId: string; cards: readonly Card[] }) {
  const filter = useDeckFilter();
  const words = wordsOf(filter.q);
  const shown = cards.filter((card) => matches(card, words, filter.picked));
  return (
    <section aria-labelledby="cards-title" className="flex flex-col gap-5 border-t pt-6 lg:pt-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h2 id="cards-title" className="text-xl font-semibold tracking-tight">
          Cards{" "}
          {cards.length > 0 && (
            <span className="font-normal text-muted-foreground tabular-nums">{cards.length}</span>
          )}
        </h2>
        {cards.length > 0 && (
          <div className="flex gap-2 sm:w-[26rem]">
            <div className="relative min-w-0 flex-1">
              <Search
                aria-hidden
                className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <input
                type="search"
                aria-label="Search cards"
                placeholder="Search"
                value={filter.q}
                onChange={(event) => filter.setQ(event.target.value)}
                className="h-11 w-full rounded-full border border-input bg-card pr-4 pl-9 text-base outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring focus-visible:outline-solid lg:h-10 lg:text-sm"
              />
            </div>
            <TagMenu cards={cards} filter={filter} />
          </div>
        )}
      </div>
      {filter.active && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-muted/60 px-3 py-2">
          <p className="text-sm font-medium tabular-nums">
            {`${shown.length} of ${cards.length} cards`}
          </p>
          {filter.picked.map((tag) => (
            <button
              key={tag}
              type="button"
              aria-label={`Stop filtering by ${tag}`}
              onClick={() => filter.toggle(tag)}
              className="inline-flex h-9 items-center gap-1 rounded-md bg-primary/10 pr-1.5 pl-2 text-sm font-medium text-primary hover:bg-primary/15 lg:h-7"
            >
              #{tag}
              <X aria-hidden className="size-3.5" />
            </button>
          ))}
          <button
            type="button"
            onClick={filter.clear}
            className="ml-auto inline-flex h-9 items-center rounded-full px-3 text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline lg:h-7"
          >
            Clear
          </button>
        </div>
      )}
      <div className="max-w-3xl">
        <NewEntry deckId={deckId} empty={cards.length === 0} />
        {cards.length > 0 && shown.length === 0 && (
          <div className="flex gap-3 sm:gap-4">
            <span aria-hidden className={TIME_COL} />
            <div className={cn(RAIL, "flex-1 border-dashed pb-8")}>
              <p className="text-lg font-medium">No cards match</p>
              <p className="max-w-sm pt-1 text-sm text-muted-foreground">
                Try fewer words or tags.
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
        {filter.active ? (
          // Filtered, the list turns flat: one run of matches, each dated in the margin.
          <ol className="pt-3">
            {shown.map((card) => (
              <Entry key={card.id} card={card} newest={false} flat />
            ))}
          </ol>
        ) : (
          byDay(shown).map(({ day, items }, i) => (
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
                  <Entry key={card.id} card={card} newest={i === 0 && j === 0} flat={false} />
                ))}
              </ol>
            </section>
          ))
        )}
      </div>
    </section>
  );
}
