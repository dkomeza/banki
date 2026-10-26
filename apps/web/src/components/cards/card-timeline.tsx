import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Plus, Trash2 } from "lucide-react";
import { TileMenu } from "@/components/tile-menu";
import { byDay, timeLabel } from "@/lib/card-days";
import type { Card } from "@/lib/cards";
import { cn } from "@/lib/utils";
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
function Entry({ card, newest }: { card: Card; newest: boolean }) {
  const queryClient = useQueryClient();
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
        <Link
          to="/cards/$cardId"
          params={{ cardId: card.id }}
          aria-label={`Edit card: ${firstLine(card.front)}`}
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

/** The deck page's Cards section: its live Cards on a timeline by day, newest first. */
export function CardTimeline({ deckId, cards }: { deckId: string; cards: readonly Card[] }) {
  return (
    <section aria-labelledby="cards-title" className="flex flex-col gap-6 border-t pt-6 lg:pt-8">
      <h2 id="cards-title" className="text-xl font-semibold tracking-tight">
        Cards{" "}
        {cards.length > 0 && (
          <span className="font-normal text-muted-foreground tabular-nums">{cards.length}</span>
        )}
      </h2>
      <div className="max-w-3xl">
        <NewEntry deckId={deckId} empty={cards.length === 0} />
        {byDay(cards).map(({ day, items }, i) => (
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
                <Entry key={card.id} card={card} newest={i === 0 && j === 0} />
              ))}
            </ol>
          </section>
        ))}
      </div>
    </section>
  );
}
