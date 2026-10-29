import type { Rating } from "@banki/shared";
import { Link } from "@tanstack/react-router";
import { AlertCircle, ArrowLeft, LoaderCircle, Undo2 } from "lucide-react";
import { useEffect, useState } from "react";
import { CardLine, CardText } from "@/components/cards/card-text";
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

// PROTOTYPE (BAN-26), Variant c, "Split": the Front and the Back as two
// panels side by side from 1024 px (stacked below), the Back's panel waiting,
// dashed, before the reveal, so nothing moves when it shows. The ratings are
// four tiles that lead with their Interval. Undo lives in a line under them
// that names the last Rating it would take back. The sidebar stays from
// 1024 px; below it the screen takes the whole window, the tab bar hidden and
// the ratings docked at the bottom.

type Last = { front: string; rating: Rating };

const FIXTURE_LAST: Partial<Record<StudyState, Last>> = {
  math: { front: "Ratio test", rating: "good" },
  undone: { front: "la cuenta", rating: "hard" },
  done: { front: "el ayuntamiento", rating: "good" },
};

export function StudyScreen({ deck, state }: { deck: Deck; state: StudyState | undefined }) {
  const study = useStudy(deck.id, state);
  // The Ratings this screen gave, newest last, to name the one Undo takes back.
  const [given, setGiven] = useState<Last[]>(() => {
    const fixture = state === undefined ? undefined : FIXTURE_LAST[state];
    return fixture === undefined ? [] : [fixture];
  });
  const rate = (rating: Rating) => {
    if (study.card === undefined || study.saving !== undefined) return;
    setGiven((g) => [...g, { front: study.card?.front ?? "", rating }]);
    study.rate(rating);
  };
  const undo = () => {
    setGiven((g) => g.slice(0, -1));
    study.undo();
  };
  // The keys rate and undo through the shared loop; follow them here too.
  const { card, revealed, saving, canUndo } = study;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        if (canUndo) setGiven((g) => g.slice(0, -1));
        return;
      }
      const rating = RATINGS[["1", "2", "3", "4"].indexOf(event.key)];
      if (rating !== undefined && revealed && saving === undefined && card !== undefined)
        setGiven((g) => [...g, { front: card.front, rating }]);
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [card, revealed, saving, canUndo]);
  const last = study.canUndo ? given[given.length - 1] : undefined;

  return (
    <div className="mx-auto flex min-h-svh w-full max-w-6xl flex-col px-4 sm:px-8 lg:min-h-0 lg:px-10 lg:py-10">
      <header className="flex h-14 items-center gap-2 lg:mb-6 lg:h-auto">
        <Button
          variant="ghost"
          size="icon"
          className="-ml-2 rounded-full text-foreground no-underline"
          aria-label="Back to deck (Esc)"
          title="Back to deck (Esc)"
          render={<Link to="/decks/$deckId" params={{ deckId: deck.id }} />}
          nativeButton={false}
        >
          <ArrowLeft aria-hidden className="size-5" />
        </Button>
        <h1 className="min-w-0 truncate text-base font-semibold tracking-tight lg:text-2xl">
          {deck.name}
        </h1>
      </header>

      {study.phase === "loading" ? null : study.phase === "card" ? (
        <>
          <Panels study={{ ...study, rate }} />
          <div className="sticky bottom-0 z-10 -mx-4 mt-auto flex flex-col gap-2 border-t bg-background/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:-mx-8 sm:px-8 lg:static lg:mx-0 lg:mt-6 lg:border-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none">
            {study.error !== undefined && <ErrorLine study={study} />}
            <Ratings study={{ ...study, rate }} />
            <UndoLine study={study} last={last} onUndo={undo} />
          </div>
        </>
      ) : (
        <End deck={deck} study={study} last={last} onUndo={undo} />
      )}
    </div>
  );
}

function Panels({ study }: { study: Study }) {
  const card = study.card;
  if (card === undefined) return null;
  const copyable =
    study.revealed &&
    "[&_[data-formula]]:cursor-copy [&_[data-formula]]:rounded-md [&_[data-formula]]:transition-colors [&_[data-formula]:hover]:bg-primary/12 [&_[data-formula]:hover]:shadow-[inset_0_-2px_0_var(--primary)]";
  return (
    // biome-ignore lint: the panels are one tap target; Space / Enter and Show answer reveal by keyboard.
    <div
      onClick={study.onCardClick}
      className={cn(
        "grid flex-1 gap-3 pb-4 lg:flex-none lg:grid-cols-2 lg:gap-5 lg:pb-0",
        !study.revealed && "cursor-pointer",
        copyable,
      )}
    >
      <section className="flex min-h-40 flex-col gap-3 rounded-[1.25rem] border bg-card p-5 text-card-foreground sm:p-7 lg:min-h-80">
        <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Front
          {study.undone && (
            <span className="ml-2 rounded-full bg-primary/12 px-2 py-0.5 tracking-normal text-primary normal-case">
              Undone: rate again
            </span>
          )}
        </h2>
        <CardText
          text={card.front}
          live={study.revealed}
          className="text-[1.5rem] leading-snug font-medium tracking-[-0.01em] lg:text-[1.75rem]"
        />
      </section>
      {study.revealed ? (
        <section className="flex flex-col gap-3 rounded-[1.25rem] border bg-card p-5 text-card-foreground sm:p-7 lg:min-h-80">
          <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Back
          </h2>
          <CardText text={card.back} live className="text-lg leading-relaxed" />
        </section>
      ) : (
        <section className="flex min-h-40 flex-col items-center justify-center gap-1 rounded-[1.25rem] border-2 border-dashed p-5 text-center text-muted-foreground lg:min-h-80">
          <span className="font-medium text-foreground">Back</span>
          <span className="text-sm">
            Tap to reveal<span className="hidden lg:inline">, or press Space</span>
          </span>
        </section>
      )}
    </div>
  );
}

function Ratings({ study }: { study: Study }) {
  if (!study.revealed)
    return (
      <Button className={cn(PILL, "h-14 w-full text-base lg:h-12")} onClick={study.reveal}>
        Show answer
      </Button>
    );
  return (
    <div className="grid grid-cols-4 gap-2 lg:gap-3">
      {RATINGS.map((rating) => (
        <button
          key={rating}
          type="button"
          disabled={study.saving !== undefined}
          onClick={() => study.rate(rating)}
          className={cn(
            "flex h-[4.5rem] flex-col items-start justify-between rounded-2xl border bg-card p-3 text-left outline-none transition-colors hover:border-ring/50 hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50 lg:h-20 lg:p-4",
          )}
        >
          <span
            className={cn(
              "flex w-full items-center justify-between text-xs font-medium text-muted-foreground lg:text-sm",
              rating === "again" && "text-destructive",
            )}
          >
            {RATING_LABELS[rating]}
            <kbd className="hidden font-sans text-[0.7rem] opacity-60 lg:inline">
              {RATING_KEYS[rating]}
            </kbd>
          </span>
          <span className="text-xl leading-none font-semibold tracking-tight tabular-nums lg:text-2xl">
            {study.saving === rating ? (
              <LoaderCircle aria-hidden className="size-5 animate-spin" />
            ) : (
              study.intervals?.[rating]
            )}
          </span>
        </button>
      ))}
    </div>
  );
}

function ErrorLine({ study }: { study: Study }) {
  return (
    <div
      role="alert"
      className="flex items-center gap-2 rounded-xl bg-destructive/8 px-3 py-1.5 text-sm text-destructive"
    >
      <AlertCircle aria-hidden className="size-4 shrink-0" />
      <span className="flex-1">{study.error}</span>
      <button
        type="button"
        onClick={study.retry}
        className="min-h-11 px-1 font-medium underline underline-offset-4 lg:min-h-8"
      >
        Try again
      </button>
    </div>
  );
}

function UndoLine({
  study,
  last,
  onUndo,
}: {
  study: Study;
  last: Last | undefined;
  onUndo: () => void;
}) {
  if (!study.canUndo) return <div className="h-11 lg:h-9" aria-hidden />;
  return (
    <div className="flex h-11 items-center gap-2 text-sm text-muted-foreground lg:h-9">
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        {last !== undefined ? (
          <>
            <span className="shrink-0">Rated</span>
            <CardLine text={last.front} className="min-w-0 font-medium text-foreground" />
            <span className="shrink-0">· {RATING_LABELS[last.rating]}</span>
          </>
        ) : (
          <span className="tabular-nums">{study.rated} rated</span>
        )}
      </span>
      <Button
        variant="outline"
        className={cn(OUTLINE_PILL, "h-11 shrink-0 lg:h-8 lg:px-3")}
        onClick={onUndo}
        title="Undo (Ctrl+Z)"
      >
        <Undo2 aria-hidden />
        Undo
      </Button>
    </div>
  );
}

function End({
  deck,
  study,
  last,
  onUndo,
}: {
  deck: Deck;
  study: Study;
  last: Last | undefined;
  onUndo: () => void;
}) {
  const nothing = study.phase === "nothing";
  return (
    <div className="flex flex-1 flex-col gap-4 lg:flex-none">
      <section className="flex flex-1 flex-col items-center justify-center gap-5 rounded-[1.25rem] border-2 border-dashed p-8 text-center lg:min-h-80 lg:flex-none">
        <h2 className="text-2xl font-semibold tracking-tight">
          {nothing ? "Nothing to study right now" : "No more cards for now"}
        </h2>
        <Button
          className={cn(PILL, "h-11 text-primary-foreground no-underline")}
          render={<Link to="/decks/$deckId" params={{ deckId: deck.id }} />}
          nativeButton={false}
        >
          Back to deck
        </Button>
      </section>
      <div className="pb-[env(safe-area-inset-bottom)]">
        <UndoLine study={study} last={last} onUndo={onUndo} />
      </div>
    </div>
  );
}
