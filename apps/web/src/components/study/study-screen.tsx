import { Link } from "@tanstack/react-router";
import { AlertCircle, ChevronLeft, LoaderCircle, Undo2 } from "lucide-react";
import { CardText } from "@/components/cards/card-text";
import { Page } from "@/components/page";
import { OUTLINE_PILL, PILL } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
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

// PROTOTYPE (BAN-26), Variant a, "Desk": the study screen stays inside the
// shell, as one more page of the Deck. One paper card in a reading column, the
// Front above a hairline and the Back below it, and the four ratings as a row
// of pills under the card. Back to the Deck and Undo sit in a header row above.

export function StudyScreen({ deck, state }: { deck: Deck; state: StudyState | undefined }) {
  const study = useStudy(deck.id, state);
  return (
    <Page width="reading">
      <div className="flex flex-col gap-5 lg:gap-6">
        <Header deck={deck} study={study} />
        {study.phase === "loading" ? (
          <div className="h-72 animate-pulse rounded-[1.25rem] border bg-card motion-reduce:animate-none" />
        ) : study.phase === "card" ? (
          <>
            {study.undone && (
              <p className="-mb-2 text-sm text-muted-foreground">
                Rating taken back. Rate this card again.
              </p>
            )}
            <StudyCard study={study} />
            <Actions study={study} />
          </>
        ) : (
          <End deck={deck} study={study} />
        )}
      </div>
    </Page>
  );
}

function Header({ deck, study }: { deck: Deck; study: Study }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <Link
        to="/decks/$deckId"
        params={{ deckId: deck.id }}
        className="-ml-2 flex min-h-11 min-w-0 items-center gap-1 rounded-lg px-2 text-sm text-muted-foreground no-underline hover:text-foreground lg:min-h-9"
      >
        <ChevronLeft aria-hidden className="size-4 shrink-0" />
        <span className="truncate">{deck.name}</span>
        <kbd className="ml-1.5 hidden rounded border px-1.5 font-sans text-[0.7rem] lg:inline">
          Esc
        </kbd>
      </Link>
      <div className="flex shrink-0 items-center gap-3">
        {study.rated > 0 && (
          <span className="text-sm text-muted-foreground tabular-nums">{study.rated} rated</span>
        )}
        <Button
          variant="outline"
          className={cn(OUTLINE_PILL, "h-11 lg:h-9 lg:px-4")}
          disabled={!study.canUndo}
          onClick={study.undo}
          title="Undo (Ctrl+Z)"
        >
          <Undo2 aria-hidden />
          Undo
        </Button>
      </div>
    </div>
  );
}

function StudyCard({ study }: { study: Study }) {
  const card = study.card;
  if (card === undefined) return null;
  return (
    // biome-ignore lint: the whole card is a tap target; Space / Enter and the button reveal by keyboard.
    <article
      onClick={study.onCardClick}
      className={cn(
        "flex min-h-72 flex-col rounded-[1.25rem] border bg-card text-card-foreground",
        !study.revealed && "cursor-pointer transition-colors hover:border-ring/40",
        study.revealed &&
          "[&_[data-formula]]:cursor-copy [&_[data-formula]]:rounded-md [&_[data-formula]]:transition-colors [&_[data-formula]:hover]:bg-primary/12",
      )}
    >
      <div className="flex flex-col gap-3 p-6 sm:p-8">
        <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {study.kind === "new" ? "New" : study.kind === "learning" ? "Learning" : "Review"}
        </span>
        <CardText
          text={card.front}
          live={study.revealed}
          className="text-[1.6rem] leading-snug font-medium tracking-[-0.01em] lg:text-[1.85rem]"
        />
      </div>
      {study.revealed ? (
        <div className="flex flex-col gap-3 border-t p-6 sm:p-8">
          <CardText text={card.back} live className="text-lg leading-relaxed" />
        </div>
      ) : (
        <p className="mt-auto p-6 pt-0 text-sm text-muted-foreground sm:p-8 sm:pt-0">
          Tap the card to see the back.
        </p>
      )}
    </article>
  );
}

function Actions({ study }: { study: Study }) {
  if (!study.revealed)
    return (
      <Button className={cn(PILL, "h-12 w-full text-base lg:h-11")} onClick={study.reveal}>
        Show answer
        <kbd className="ml-2 hidden rounded border border-primary-foreground/30 px-1.5 font-sans text-[0.7rem] lg:inline">
          Space
        </kbd>
      </Button>
    );
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-4 gap-2">
        {RATINGS.map((rating) => (
          <button
            key={rating}
            type="button"
            disabled={study.saving !== undefined}
            onClick={() => study.rate(rating)}
            className={cn(
              "flex min-h-16 flex-col items-center justify-center gap-0.5 rounded-2xl border bg-background px-1 text-sm font-medium outline-none transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50 lg:min-h-14 dark:bg-input/20",
              rating === "again" && "text-destructive",
            )}
          >
            <span className="flex items-center gap-1.5">
              {study.saving === rating && (
                <LoaderCircle aria-hidden className="size-3.5 animate-spin" />
              )}
              {RATING_LABELS[rating]}
            </span>
            <span className="text-xs font-normal text-muted-foreground tabular-nums">
              {study.intervals?.[rating]}
              <kbd className="ml-1.5 hidden font-sans opacity-60 lg:inline">
                {RATING_KEYS[rating]}
              </kbd>
            </span>
          </button>
        ))}
      </div>
      {study.error !== undefined && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-destructive/8 px-4 py-2.5 text-sm text-destructive"
        >
          <AlertCircle aria-hidden className="size-4 shrink-0" />
          <span className="flex-1">{study.error}</span>
          <button
            type="button"
            onClick={study.retry}
            className="min-h-11 font-medium underline underline-offset-4 lg:min-h-0"
          >
            Try again
          </button>
        </div>
      )}
    </div>
  );
}

function End({ deck, study }: { deck: Deck; study: Study }) {
  const nothing = study.phase === "nothing";
  return (
    <section className="flex min-h-72 flex-col items-start justify-center gap-5 rounded-[1.25rem] border bg-card p-6 text-card-foreground sm:p-8">
      <h1 className="text-2xl font-semibold tracking-tight">
        {nothing ? "Nothing to study right now" : "That's every card for now"}
      </h1>
      {!nothing && (
        <p className="-mt-3 text-muted-foreground">
          You rated {study.rated} {study.rated === 1 ? "card" : "cards"} in {deck.name}.
        </p>
      )}
      <Button
        className={cn(PILL, "h-11 text-primary-foreground no-underline")}
        render={<Link to="/decks/$deckId" params={{ deckId: deck.id }} />}
        nativeButton={false}
      >
        Back to deck
      </Button>
    </section>
  );
}
