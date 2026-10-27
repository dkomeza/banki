import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Plus, Search, Trash2, X } from "lucide-react";
import { useState } from "react";
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
          {tags.length > 0 && (
            <ul aria-label="Tags" className="flex flex-wrap gap-x-2.5 px-4 pt-2.5 pr-14 sm:px-5">
              {tags.map((tag) => (
                <li key={tag}>
                  <button
                    type="button"
                    aria-pressed={picked.includes(tag)}
                    title={picked.includes(tag) ? `Stop filtering by ` : `Show only `}
                    onClick={() => onTag(tag)}
                    className="inline-flex min-h-8 items-center text-[0.8rem] font-semibold tracking-wide text-primary/80 underline-offset-4 hover:text-primary hover:underline aria-pressed:text-primary aria-pressed:underline lg:min-h-0"
                  >
                    #{tag}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Link
            to="/cards/$cardId"
            params={{ cardId: card.id }}
            className={cn(
              "flex flex-col gap-1 rounded-xl px-4 pb-3 pr-14 no-underline outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid sm:px-5 sm:pb-3.5",
              tags.length > 0 ? "pt-1" : "pt-3 sm:pt-3.5",
            )}
          >
            <p className="text-[1.1rem] leading-snug font-semibold tracking-tight whitespace-pre-wrap text-foreground [overflow-wrap:anywhere]">
              <Marked text={card.front} words={words} />
            </p>
            <p className="line-clamp-6 leading-relaxed whitespace-pre-wrap text-muted-foreground [overflow-wrap:anywhere]">
              <Marked text={card.back} words={words} />
            </p>
          </Link>
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

/** Text with the runs matching the search in ink, underlined in the accent. */
function Marked({ text, words }: { text: string; words: readonly string[] }) {
  return highlight(text, words).map((run, i) =>
    run.hit ? (
      <mark
        key={i}
        className="bg-transparent font-semibold text-foreground underline decoration-primary decoration-2 underline-offset-[0.2em]"
      >
        {run.text}
      </mark>
    ) : (
      run.text
    ),
  );
}

type Filter = ReturnType<typeof useDeckFilter>;

/**
 * Variant c: one query line. The picked Tags are chips inside the search
 * field, before the words; typing `#` offers the Deck's Tags, and Backspace in
 * an empty field takes the last one off. The Deck's Tags are listed under it.
 */
function QueryLine({ cards, filter }: { cards: readonly Card[]; filter: Filter }) {
  const [active, setActive] = useState(0);
  const [focused, setFocused] = useState(false);
  const tags = deckTags(cards);
  const last = filter.q.split(/\s+/).at(-1) ?? "";
  const hashing = last.startsWith("#");
  const options = hashing
    ? tags.filter(
        ({ tag }) => tag.includes(last.slice(1).toLowerCase()) && !filter.picked.includes(tag),
      )
    : [];
  const open = focused && hashing && options.length > 0;
  const pick = (tag: string) => {
    filter.setBoth(filter.q.slice(0, filter.q.length - last.length).trimEnd(), [
      ...filter.picked,
      tag,
    ]);
    setActive(0);
  };
  return (
    <div className="flex flex-col gap-2.5">
      <div className="relative">
        {/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- the input inside takes the keys */}
        <div className="flex min-h-12 flex-wrap items-center gap-1.5 rounded-2xl border border-input bg-card py-1.5 pr-12 pl-10 shadow-xs focus-within:border-ring focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-ring focus-within:outline-solid">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-4 left-4 size-4 text-muted-foreground"
          />
          {filter.picked.map((tag) => (
            <span
              key={tag}
              className="inline-flex h-8 items-center gap-0.5 rounded-lg bg-primary pr-0.5 pl-2 text-sm font-medium text-primary-foreground lg:h-7"
            >
              #{tag}
              <button
                type="button"
                aria-label={`Stop filtering by ${tag}`}
                onClick={() => filter.toggle(tag)}
                className="flex size-7 items-center justify-center rounded-md hover:bg-black/15 lg:size-6"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </span>
          ))}
          <input
            type="text"
            role="combobox"
            aria-expanded={open}
            aria-autocomplete="list"
            aria-label="Search cards, or # for a tag"
            placeholder={filter.picked.length === 0 ? "Search, or type # for a tag" : "Search"}
            value={filter.q}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onChange={(event) => {
              filter.setQ(event.target.value);
              setActive(0);
            }}
            onKeyDown={(event) => {
              if (open && event.key === "ArrowDown") {
                event.preventDefault();
                setActive((i) => Math.min(i + 1, options.length - 1));
              } else if (open && event.key === "ArrowUp") {
                event.preventDefault();
                setActive((i) => Math.max(i - 1, 0));
              } else if (open && event.key === "Enter") {
                event.preventDefault();
                const option = options[active];
                if (option !== undefined) pick(option.tag);
              } else if (event.key === "Backspace" && filter.q === "" && filter.picked.length > 0) {
                filter.setTags(filter.picked.slice(0, -1));
              }
            }}
            className="h-9 min-w-32 flex-1 bg-transparent px-1 text-base outline-none placeholder:text-muted-foreground lg:text-[0.95rem]"
          />
        </div>
        {filter.active && (
          <button
            type="button"
            aria-label="Clear the search and tags"
            onClick={filter.clear}
            className="absolute top-0.5 right-0.5 flex size-11 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" aria-hidden />
          </button>
        )}
        {open && (
          <ul
            role="listbox"
            aria-label="Tags in this deck"
            className="absolute top-full left-0 z-30 mt-1.5 w-64 rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-xl"
          >
            {options.map(({ tag, count }, index) => (
              <li
                key={tag}
                role="option"
                aria-selected={index === active}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => pick(tag)}
                onPointerEnter={() => setActive(index)}
                className={cn(
                  "flex min-h-11 cursor-default items-center justify-between rounded-lg px-3 text-[0.95rem] lg:min-h-9",
                  index === active && "bg-accent",
                )}
              >
                #{tag}
                <span className="text-sm text-muted-foreground tabular-nums">{count}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="text-sm leading-7 text-muted-foreground">
        <span className="mr-1">Tags here:</span>
        {tags.map(({ tag }) => (
          <button
            key={tag}
            type="button"
            aria-pressed={filter.picked.includes(tag)}
            onClick={() => filter.toggle(tag)}
            className="mr-2 font-medium text-foreground/75 underline-offset-4 hover:text-primary hover:underline aria-pressed:text-primary aria-pressed:underline"
          >
            #{tag}
          </button>
        ))}
      </p>
    </div>
  );
}

/** The deck page's Cards section: its live Cards on a timeline by day, newest first. */
export function CardTimeline({ deckId, cards }: { deckId: string; cards: readonly Card[] }) {
  const filter = useDeckFilter();
  // A word still being typed as `#tag` searches nothing yet.
  const words = wordsOf(filter.q).filter((w) => !w.startsWith("#"));
  const shown = cards.filter((card) => matches(card, words, filter.picked));
  return (
    <section aria-labelledby="cards-title" className="flex flex-col gap-5 border-t pt-6 lg:pt-8">
      <h2 id="cards-title" className="text-xl font-semibold tracking-tight">
        Cards{" "}
        {cards.length > 0 &&
          (filter.active ? (
            <span className="font-normal text-primary tabular-nums">
              · {shown.length === 1 ? "1 match" : `${shown.length} matches`}
            </span>
          ) : (
            <span className="font-normal text-muted-foreground tabular-nums">{cards.length}</span>
          ))}
      </h2>
      {cards.length > 0 && (
        <div className="max-w-3xl">
          <QueryLine cards={cards} filter={filter} />
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
                None of the {cards.length} cards here has all of that.
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
