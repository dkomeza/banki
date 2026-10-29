import { Link } from "@tanstack/react-router";
import { AlertCircle, LoaderCircle, Undo2, X } from "lucide-react";
import { CardText } from "@/components/cards/card-text";
import { PILL } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import type { Deck } from "@/lib/decks";
import {
  RATINGS,
  RATING_KEYS,
  RATING_LABELS,
  type Study,
  type StudyState,
  useStudy,
} from "@/lib/study-proto";
import { cn } from "@/lib/utils";

// PROTOTYPE (BAN-26), Variant b, "Focus": the study screen leaves the shell
// and takes the whole window, with nothing but the Card on plain paper. A thin
// top bar holds close (×), the Deck's name and Undo; the Card sits in the
// middle, the Front large; and the actions dock to the bottom, in thumb
// reach: Show answer, then four equal ratings led by their Interval.

export function StudyScreen({ deck, state }: { deck: Deck; state: StudyState | undefined }) {
  const study = useStudy(deck.id, state);
  return (
    <div className="flex min-h-svh flex-col pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)] [--toast-bottom:calc(7.5rem+env(safe-area-inset-bottom))]">
      <TopBar deck={deck} study={study} />
      <main className="flex flex-1 flex-col">
        {study.phase === "loading" ? null : study.phase === "card" ? (
          <CardView study={study} />
        ) : (
          <End deck={deck} study={study} />
        )}
      </main>
      {study.phase === "card" && <Dock study={study} />}
      <Toaster />
    </div>
  );
}

function TopBar({ deck, study }: { deck: Deck; study: Study }) {
  return (
    <header className="sticky top-0 z-10 grid h-14 grid-cols-[1fr_auto_1fr] items-center gap-2 bg-background/95 px-2 backdrop-blur sm:px-4">
      <Button
        variant="ghost"
        size="icon"
        className="rounded-full text-foreground no-underline"
        aria-label="Back to deck (Esc)"
        title="Back to deck (Esc)"
        render={<Link to="/decks/$deckId" params={{ deckId: deck.id }} />}
        nativeButton={false}
      >
        <X aria-hidden className="size-5" />
      </Button>
      <span className="max-w-[50vw] truncate text-center text-sm font-medium text-muted-foreground">
        {deck.name}
      </span>
      <div className="flex items-center justify-end gap-2">
        {study.rated > 0 && (
          <span className="hidden text-sm text-muted-foreground tabular-nums sm:inline">
            {study.rated} rated
          </span>
        )}
        <Button
          variant="ghost"
          className="h-11 gap-1.5 rounded-full px-3 lg:h-9"
          disabled={!study.canUndo}
          onClick={study.undo}
          title="Undo (Ctrl+Z)"
          aria-label="Undo"
        >
          <Undo2 aria-hidden className="size-4" />
          <span className="hidden sm:inline">Undo</span>
        </Button>
      </div>
    </header>
  );
}

function CardView({ study }: { study: Study }) {
  const card = study.card;
  if (card === undefined) return null;
  return (
    // biome-ignore lint: the whole Card is a tap target; Space / Enter and Show answer reveal by keyboard.
    <div
      onClick={study.onCardClick}
      className={cn(
        "mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 pt-6 pb-10 sm:px-10 lg:pt-12",
        !study.revealed && "cursor-pointer justify-center",
        study.revealed &&
          "[&_[data-formula]]:cursor-copy [&_[data-formula]]:rounded-md [&_[data-formula]]:outline-offset-2 [&_[data-formula]:hover]:outline-1 [&_[data-formula]:hover]:outline-primary/60 [&_[data-formula]:hover]:outline-dashed",
      )}
    >
      {study.undone && (
        <span className="mb-4 w-fit rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
          Back from Undo: rate it again
        </span>
      )}
      <CardText
        text={card.front}
        live={study.revealed}
        className={cn(
          "font-medium tracking-[-0.015em] transition-[font-size] motion-reduce:transition-none",
          study.revealed
            ? "text-xl leading-snug text-muted-foreground lg:text-2xl"
            : "text-[1.85rem] leading-tight lg:text-[2.6rem]",
        )}
      />
      {study.revealed ? (
        <>
          <div aria-hidden className="my-6 h-px w-16 bg-border lg:my-8" />
          <CardText text={card.back} live className="text-lg leading-relaxed lg:text-xl" />
        </>
      ) : (
        <p className="mt-8 text-sm text-muted-foreground">Tap anywhere to reveal</p>
      )}
    </div>
  );
}

function Dock({ study }: { study: Study }) {
  return (
    <div className="sticky bottom-0 z-10 border-t bg-background/95 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-2 px-3 pt-3 sm:px-6">
        {study.error !== undefined && (
          <div role="alert" className="flex items-center gap-2 px-1 text-sm text-destructive">
            <AlertCircle aria-hidden className="size-4 shrink-0" />
            <span className="flex-1">{study.error}</span>
            <Button
              variant="outline"
              className={cn(PILL, "h-11 border-destructive/40 text-destructive lg:h-8 lg:px-3")}
              onClick={study.retry}
            >
              Try again
            </Button>
          </div>
        )}
        {study.revealed ? (
          <div className="grid grid-cols-4 overflow-hidden rounded-2xl border bg-card">
            {RATINGS.map((rating, i) => (
              <button
                key={rating}
                type="button"
                disabled={study.saving !== undefined}
                onClick={() => study.rate(rating)}
                className={cn(
                  "relative flex h-[4.5rem] flex-col items-center justify-center gap-0.5 outline-none transition-colors hover:bg-muted focus-visible:z-10 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring disabled:opacity-50 lg:h-16",
                  i > 0 && "border-l",
                )}
              >
                <span className="text-lg font-semibold tabular-nums">
                  {study.saving === rating ? (
                    <LoaderCircle aria-hidden className="size-5 animate-spin" />
                  ) : (
                    study.intervals?.[rating]
                  )}
                </span>
                <span
                  className={cn(
                    "text-xs font-medium text-muted-foreground",
                    rating === "again" && "text-destructive",
                  )}
                >
                  {RATING_LABELS[rating]}
                </span>
                <kbd className="absolute top-1.5 right-2 hidden font-sans text-[0.65rem] text-muted-foreground/70 lg:block">
                  {RATING_KEYS[rating]}
                </kbd>
              </button>
            ))}
          </div>
        ) : (
          <Button className={cn(PILL, "h-14 w-full text-base lg:h-14")} onClick={study.reveal}>
            Show answer
            <kbd className="ml-2 hidden rounded border border-primary-foreground/30 px-1.5 font-sans text-[0.7rem] lg:inline">
              Space
            </kbd>
          </Button>
        )}
      </div>
    </div>
  );
}

function End({ deck, study }: { deck: Deck; study: Study }) {
  const nothing = study.phase === "nothing";
  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-5 px-6 pb-24 text-center">
      <h1 className="text-[1.85rem] leading-tight font-semibold tracking-[-0.02em] lg:text-4xl">
        {nothing ? "Nothing to study right now" : "Done for now"}
      </h1>
      {!nothing && (
        <p className="-mt-2 text-muted-foreground tabular-nums">
          {study.rated} {study.rated === 1 ? "card" : "cards"} rated. Undo is still up there if you
          need it.
        </p>
      )}
      <Button
        className={cn(PILL, "h-12 px-7 text-base text-primary-foreground no-underline lg:h-11")}
        render={<Link to="/decks/$deckId" params={{ deckId: deck.id }} />}
        nativeButton={false}
      >
        Back to deck
      </Button>
    </div>
  );
}
