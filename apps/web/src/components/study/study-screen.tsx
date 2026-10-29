import { RATINGS } from "@banki/shared";
import { Link, useNavigate } from "@tanstack/react-router";
import { AlertCircle, LoaderCircle, Undo2, X } from "lucide-react";
import { type MouseEvent, useEffect, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { CardText } from "@/components/cards/card-text";
import { PILL } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import type { Deck } from "@/lib/decks";
import {
  RATING_KEYS,
  RATING_LABELS,
  type StudySession,
  type StudyState,
  cardClickAction,
  copyFormula,
  createStudySession,
  formatInterval,
  keyAction,
  studyApi,
} from "@/lib/study";
import { cn } from "@/lib/utils";

// The study screen ("Focus"): it leaves the shell and takes the whole window,
// with nothing but the Card on plain paper. A thin top bar holds close (×),
// the Deck's name and Undo; the actions dock to the bottom, in thumb reach:
// Show answer, then four equal ratings led by their Interval. Going from Card
// to Card, nothing moves: the Front keeps its size and place, and the Back
// opens below it.

/** A Session over the Deck's Queue, started on mount and stopped on unmount. */
function useStudySession(deckId: string): [StudySession, StudyState] {
  const [session] = useState(() =>
    createStudySession({ studyApi: studyApi(deckId), notify: (m) => toast(m) }),
  );
  useEffect(() => {
    void session.start();
    return () => session.stop();
  }, [session]);
  return [session, useSyncExternalStore(session.subscribe, session.getState)];
}

export function StudyScreen({ deck }: { deck: Deck }) {
  const navigate = useNavigate();
  const [session, state] = useStudySession(deck.id);

  // Desktop keys: Space / Enter reveal, 1–4 rate, Ctrl/⌘+Z undoes, Esc leaves.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("input, textarea, select, [contenteditable]")) return;
      const { revealed } = session.getState();
      const action = keyAction(event, { revealed });
      // Space and Enter never rate, not even on a focused rating button.
      if ((event.key === " " || event.key === "Enter") && target?.closest("[data-rating]")) {
        event.preventDefault();
      }
      switch (action.type) {
        case "reveal":
          event.preventDefault();
          session.reveal();
          break;
        case "rate":
          session.rate(action.rating);
          break;
        case "undo":
          event.preventDefault();
          void session.undo();
          break;
        case "leave":
          void navigate({ to: "/decks/$deckId", params: { deckId: deck.id } });
          break;
        case "none":
          break;
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [session, navigate, deck.id]);

  return (
    <div className="flex min-h-svh flex-col pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)] [--toast-bottom:calc(7.5rem+env(safe-area-inset-bottom))]">
      <TopBar deck={deck} state={state} onUndo={() => void session.undo()} />
      <main className="flex flex-1 flex-col">
        {state.phase === "card" ? (
          <CardView session={session} state={state} />
        ) : state.phase === "loading" ? null : (
          <End deck={deck} state={state} onRetry={() => session.retry()} />
        )}
      </main>
      {state.phase === "card" && session !== undefined && <Dock session={session} state={state} />}
      <Toaster />
    </div>
  );
}

function TopBar({ deck, state, onUndo }: { deck: Deck; state: StudyState; onUndo: () => void }) {
  return (
    <header className="sticky top-0 z-10 grid h-14 grid-cols-[1fr_auto_1fr] items-center gap-2 bg-background/95 px-2 backdrop-blur sm:px-4">
      <Button
        variant="ghost"
        size="icon"
        className="rounded-full text-foreground no-underline"
        aria-label="Back to deck"
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
        {state.rated > 0 && (
          <span className="hidden text-sm text-muted-foreground tabular-nums sm:inline">
            {state.rated} rated
          </span>
        )}
        <Button
          variant="ghost"
          className="h-11 gap-1.5 rounded-full px-3 lg:h-9"
          disabled={state.rated === 0 || state.undoing || state.saving !== undefined}
          onClick={onUndo}
          title="Undo (Ctrl+Z)"
          aria-label="Undo"
        >
          {state.undoing ? (
            <LoaderCircle aria-hidden className="size-4 animate-spin" />
          ) : (
            <Undo2 aria-hidden className="size-4" />
          )}
          <span className="hidden sm:inline">Undo</span>
        </Button>
      </div>
    </header>
  );
}

function CardView({ session, state }: { session: StudySession; state: StudyState }) {
  const card = state.shown?.card;
  if (card === undefined) return null;
  const onClick = (event: MouseEvent) => {
    if (!(event.target instanceof Element)) return;
    const action = cardClickAction(event.target, { revealed: state.revealed });
    if (action.type === "reveal") session.reveal();
    if (action.type === "copy") {
      void copyFormula(action.source, {
        clipboard: globalThis.navigator.clipboard,
        notify: (m) => toast(m),
      });
    }
  };
  return (
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- the whole Card is a tap target; Space / Enter and Show answer reveal by keyboard.
    <div
      onClick={onClick}
      className={cn(
        "mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 pt-6 pb-10 sm:px-10 lg:pt-12",
        !state.revealed && "cursor-pointer",
        // A Formula shows it can be copied: the pointer, and a dashed outline on hover.
        state.revealed &&
          "[&_[data-formula]]:cursor-pointer [&_[data-formula]]:rounded-md [&_[data-formula]]:outline-offset-2 [&_[data-formula]:hover]:outline-1 [&_[data-formula]:hover]:outline-primary/60 [&_[data-formula]:hover]:outline-dashed",
      )}
    >
      {state.undone && (
        <span className="mb-4 w-fit rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
          Back from Undo: rate it again
        </span>
      )}
      <CardText
        key={`${card.id}-front`}
        text={card.front}
        interactive={state.revealed}
        className="text-[1.85rem] leading-tight font-medium tracking-[-0.015em] lg:text-[2.6rem]"
      />
      {state.revealed ? (
        <>
          <div aria-hidden className="my-6 h-px w-16 bg-border lg:my-8" />
          <CardText
            key={`${card.id}-back`}
            text={card.back}
            interactive
            className="text-lg leading-relaxed lg:text-xl"
          />
        </>
      ) : (
        <p className="mt-8 text-sm text-muted-foreground">Tap anywhere to reveal</p>
      )}
    </div>
  );
}

function Dock({ session, state }: { session: StudySession; state: StudyState }) {
  const intervals = state.shown?.intervals;
  return (
    <div className="sticky bottom-0 z-10 border-t bg-background/95 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-2 px-3 pt-3 sm:px-6">
        {state.failure !== undefined && (
          <div role="alert" className="flex items-center gap-2 px-1 text-sm text-destructive">
            <AlertCircle aria-hidden className="size-4 shrink-0" />
            <span className="flex-1">{state.failure}</span>
            <Button
              variant="outline"
              className={cn(PILL, "h-11 border-destructive/40 text-destructive lg:h-8 lg:px-3")}
              disabled={state.saving !== undefined}
              onClick={() => session.retry()}
            >
              Try again
            </Button>
          </div>
        )}
        {state.revealed ? (
          <div className="grid grid-cols-4 overflow-hidden rounded-2xl border bg-card">
            {RATINGS.map((rating, i) => (
              <button
                key={rating}
                type="button"
                data-rating={rating}
                disabled={!state.ratable}
                onClick={() => session.rate(rating)}
                aria-label={`${RATING_LABELS[rating]}${intervals ? `, ${formatInterval(intervals[rating], state.previewedAt)}` : ""}`}
                className={cn(
                  "relative flex h-[4.5rem] flex-col items-center justify-center gap-0.5 outline-none transition-colors hover:bg-muted focus-visible:z-10 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 lg:h-16",
                  i > 0 && "border-l",
                )}
              >
                <span className="flex h-7 items-center text-lg font-semibold tabular-nums">
                  {state.saving === rating ? (
                    <LoaderCircle aria-hidden className="size-5 animate-spin" />
                  ) : (
                    intervals && formatInterval(intervals[rating], state.previewedAt)
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
                <kbd
                  aria-hidden
                  className="absolute top-1.5 right-2 hidden font-sans text-[0.65rem] text-muted-foreground/70 lg:block"
                >
                  {RATING_KEYS[rating]}
                </kbd>
              </button>
            ))}
          </div>
        ) : (
          <Button
            className={cn(PILL, "h-[4.5rem] w-full text-base lg:h-16")}
            onClick={() => session.reveal()}
          >
            Show answer
            <kbd
              aria-hidden
              className="ml-2 hidden rounded border border-primary-foreground/30 px-1.5 font-sans text-[0.7rem] lg:inline"
            >
              Space
            </kbd>
          </Button>
        )}
      </div>
    </div>
  );
}

function End({ deck, state, onRetry }: { deck: Deck; state: StudyState; onRetry: () => void }) {
  const title =
    state.phase === "nothing"
      ? "Nothing to study right now"
      : state.phase === "unreachable"
        ? "Can't reach Banki"
        : "Done for now";
  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-5 px-6 pb-24 text-center">
      <h1 className="text-[1.85rem] leading-tight font-semibold tracking-[-0.02em] lg:text-4xl">
        {title}
      </h1>
      {state.phase === "done" && state.rated > 0 && (
        <p className="-mt-2 text-muted-foreground tabular-nums">
          {state.rated} {state.rated === 1 ? "card" : "cards"} rated. Undo is still up there if you
          need it.
        </p>
      )}
      {state.phase === "unreachable" ? (
        <Button className={cn(PILL, "h-12 px-7 text-base lg:h-11")} onClick={onRetry}>
          Try again
        </Button>
      ) : (
        <Button
          className={cn(PILL, "h-12 px-7 text-base text-primary-foreground no-underline lg:h-11")}
          render={<Link to="/decks/$deckId" params={{ deckId: deck.id }} />}
          nativeButton={false}
        >
          Back to deck
        </Button>
      )}
    </div>
  );
}
