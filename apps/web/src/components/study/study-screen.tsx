import { RATINGS, deckAnswerMode } from "@banki/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { AlertCircle, LoaderCircle, Undo2, X } from "lucide-react";
import { type MouseEvent, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { CardText } from "@/components/cards/card-text";
import { OUTLINE_PILL, PILL } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { AnswerEditor, DontKnowDock, WriteDock, WriteToggle } from "@/components/study/answer";
import { GRADED_WIDTH, GradedCard, GradedRatings } from "@/components/study/grade";
import {
  ChatContext,
  prepareProtoSession,
  replying,
  protoStudyApi,
  useChatProto,
  useProtoCheck,
  useStateReload,
} from "@/components/study/chat-proto";
import { ChatSheet, SheetShade, sheetRoom } from "@/components/study/chat-sheet";
import { morph } from "@/components/study/morph";
import {
  EditButton,
  MODIFIER_KEYS,
  ResetNote,
  StudyEditor,
  leaveOrCancelEdit,
  type StudyEditorHandle,
} from "@/components/study/study-editor";
import { Summary } from "@/components/study/summary";
import { cardsQueryOptions } from "@/lib/cards";
import { type Deck, deckQueryOptions } from "@/lib/decks";
import { moreOffer } from "@/lib/new-cards";
import { sessionStore, timeoutMsOf } from "@/lib/session-store";
import { settingsQueryOptions } from "@/lib/settings";
import { tagsQueryOptions } from "@/lib/tags";
import {
  RATE_FAILED,
  RATING_KEYS,
  RATING_LABELS,
  type StudySession,
  type StudyState,
  cardClickAction,
  copyFormula,
  createStudySession,
  editorEscAction,
  editorOpener,
  formatInterval,
  isEditKey,
  keyAction,
} from "@/lib/study";
import { cn } from "@/lib/utils";

// The study screen ("Focus"): it leaves the shell and takes the whole window,
// with nothing but the Card on plain paper. A thin top bar holds close (×),
// the Deck's name, the Write toggle (the Answer mode), Edit and Undo; the actions dock to the bottom, in thumb reach:
// Show answer, then four equal ratings led by their Interval. Going from Card
// to Card, nothing moves: the Front always starts at the top, in the same
// place. Revealed, it steps back (smaller, muted) and the Back opens below it.
// At the end of the Queue, or on leaving with a Rating standing, the summary
// (Summary) takes the Card's place; Esc or × from there goes to the deck page.
// Edit opens the editor over the Card (StudyEditor) without leaving the
// Session. The Session is saved in the browser and resumes on the next visit
// (ADR-0027); past its Session timeout, the summary says it ended. In
// write-and-grade the answer editor sits under the Front, and the dock holds
// I don't know and Check (answer.tsx); after Check, the Grader's result shows
// with the Back, and the ratings wait for a confirm until its suggestion is in
// (grade.tsx).

/** How often a visible screen checks the Session timeout. */
const TIMEOUT_CHECK_MS = 15_000;

/**
 * A Session over the Deck's Queue, saved in the browser, started (or
 * resumed) on mount and stopped on unmount. Its timeout is the Settings', the
 * default without them, and a new one starts in the Deck's Answer mode. It checks the timeout on focus, on becoming visible,
 * and on a timer while visible, and saves the shown Card's time as the page
 * hides.
 */
function useStudySession(deck: Deck): [StudySession, StudyState] {
  const deckId = deck.id;
  const queryClient = useQueryClient();
  const [session] = useState(() => {
    // PROTOTYPE (BAN-42): the Grader stubbed, and `?state=` on a fresh Session.
    prepareProtoSession();
    return createStudySession({
      studyApi: protoStudyApi(deckId),
      notify: (m) => toast(m),
      transition: morph,
      store: sessionStore(deckId),
      timeoutMs: () =>
        timeoutMsOf(
          queryClient.getQueryData(settingsQueryOptions().queryKey)?.settings.sessionTimeoutMinutes,
        ),
      // Read as each new Session starts: the Deck as it is then.
      answerMode: () =>
        deckAnswerMode(queryClient.getQueryData(deckQueryOptions(deckId).queryKey) ?? deck),
    });
  });
  useEffect(() => {
    void session.start();
    return () => session.stop();
  }, [session]);
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const watch = () => {
      clearInterval(timer);
      timer = undefined;
      if (document.visibilityState === "hidden") return;
      session.checkTimeout();
      timer = setInterval(() => session.checkTimeout(), TIMEOUT_CHECK_MS);
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") session.persist();
      watch();
    };
    const onFocus = () => session.checkTimeout();
    const onHide = () => session.persist();
    watch();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    window.addEventListener("pagehide", onHide);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pagehide", onHide);
    };
  }, [session]);
  return [session, useSyncExternalStore(session.subscribe, session.getState)];
}

export function StudyScreen({ deck }: { deck: Deck }) {
  const navigate = useNavigate();
  const [session, state] = useStudySession(deck);
  const queryClient = useQueryClient();
  const editor = useRef<StudyEditorHandle>(null);
  // The editor's Duplicate warning and Tag suggestions read these: fetched
  // ahead, and watched for the whole Session so they stay cached, so opening
  // it doesn't wait. Watching them re-renders nothing.
  useQuery({ ...cardsQueryOptions(deck.id), notifyOnChangeProps: [] });
  useQuery({ ...tagsQueryOptions(), notifyOnChangeProps: [] });
  useEffect(() => {
    // Ratings change whether a Card is studied: the edit page fetches each one afresh after.
    return () => queryClient.removeQueries({ queryKey: ["cards"] });
  }, [queryClient]);
  // The editor suspends until the Deck's Cards are in, which would leave it
  // out of the View Transition's new frame: it opens once they are.
  const [opener] = useState(() =>
    editorOpener({
      session,
      ready: () => queryClient.ensureQueryData(cardsQueryOptions(deck.id)),
      notify: (m) => toast(m),
    }),
  );
  useEffect(() => {
    opener.start();
    return () => opener.stop();
  }, [opener]);
  const openEditor = opener.open;
  // PROTOTYPE (BAN-42): the Follow-up chat, stubbed.
  useProtoCheck(session, state);
  useStateReload();
  const chat = useChatProto(state);

  // Desktop keys: Space / Enter reveal, 1–4 rate, E edits, Ctrl/⌘+Z undoes,
  // Esc leaves. While the editor is open, they are its own. In write-and-grade
  // Space / Enter reveal nothing, and after I don't know they press Next.
  // While the answer editor has the focus, they are its own too, but Esc: the
  // first leaves the field (CodeMirror's Esc-then-Tab), and a second leaves.
  useEffect(() => {
    let escArmed: Element | null = null;
    const onPointer = () => {
      escArmed = null;
    };
    // Held, the E that opened the editor opens it once, and its repeats don't
    // type into the field it focuses. Its keyup can land in another window.
    let holdingE = false;
    const onKeyUp = (event: KeyboardEvent) => {
      if (isEditKey(event)) holdingE = false;
    };
    const onBlur = () => {
      holdingE = false;
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat && holdingE && isEditKey(event)) {
        event.preventDefault();
        return;
      }
      if (event.key !== "Escape" && !MODIFIER_KEYS.has(event.key)) escArmed = null;
      if (event.defaultPrevented || event.repeat) {
        if (event.key === "Escape" && event.defaultPrevented) escArmed = null;
        return;
      }
      const target = event.target instanceof Element ? event.target : null;
      const field = target?.closest("[data-answer-editor] .cm-editor") ?? null;
      if (field !== null && event.key === "Escape") {
        if (event.isComposing || editorEscAction(field, escArmed) === "leave-field") {
          escArmed = field;
          return;
        }
        escArmed = null;
      } else if (target?.closest("input, textarea, select, [contenteditable]")) return;
      const { phase, revealed, editing, mode, dontKnow, grade } = session.getState();
      const action = keyAction(event, {
        showing: phase === "card",
        revealed,
        editing,
        writing: mode === "write" && !revealed,
        waiting: dontKnow,
        confirming: grade !== undefined,
        focus: target?.closest("[data-rating]")
          ? "rating"
          : target?.closest("a, button")
            ? "control"
            : undefined,
      });
      switch (action.type) {
        case "block":
          event.preventDefault();
          break;
        case "reveal":
          event.preventDefault();
          session.reveal();
          break;
        case "next":
          event.preventDefault();
          session.next();
          break;
        case "confirm":
          event.preventDefault();
          session.confirm();
          break;
        case "rate":
          session.rate(action.rating);
          break;
        case "undo":
          event.preventDefault();
          void session.undo();
          break;
        case "edit":
          event.preventDefault();
          holdingE = true;
          if (session.getState().editable) openEditor();
          break;
        case "leave":
          if (session.leave() === "away") {
            void navigate({
              to: "/decks/$deckId",
              params: { deckId: deck.id },
            });
          }
          break;
        case "none":
          break;
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("keyup", onKeyUp);
    document.addEventListener("pointerdown", onPointer);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("keyup", onKeyUp);
      document.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("blur", onBlur);
    };
  }, [session, navigate, deck.id, openEditor]);

  return (
    <ChatContext value={chat}>
      <div className="flex min-h-svh flex-col pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)] [--toast-bottom:calc(7.5rem+env(safe-area-inset-bottom))]">
        <TopBar
          deck={deck}
          session={session}
          state={state}
          onUndo={() => void session.undo()}
          onEdit={openEditor}
          onLeave={() => leaveOrCancelEdit(session, editor.current)}
          chatBusy={replying(chat[0])}
        />
        <main className={cn("flex flex-1 flex-col", chat[2] && sheetRoom(chat[0]))}>
          {state.phase === "card" ? (
            <CardView session={session} state={state} />
          ) : state.phase === "loading" ? null : (state.phase === "done" ||
              state.phase === "left" ||
              state.phase === "ended") &&
            state.summary.studied > 0 ? (
            <Summary
              deck={deck}
              summary={state.summary}
              progress={session.overviewProgress()}
              left={state.phase === "left"}
              endedAfterMs={state.phase === "ended" ? state.endedAfterMs : undefined}
              onRestart={() => session.restart()}
              newHeld={state.newHeld}
              loadingMore={state.loadingMore}
              onMore={() => session.more()}
              onResume={() => session.resume()}
            />
          ) : (
            <End
              deck={deck}
              state={state}
              onRetry={() => session.retry()}
              onMore={() => session.more()}
            />
          )}
        </main>
        {state.phase === "card" && session !== undefined && (
          <Dock session={session} state={state} room={chat[2] && sheetRoom(chat[0])} />
        )}
        <SheetShade />
        <ChatSheet
          suggested={state.grade?.status === "graded" ? state.grade.result.rating : undefined}
        />
        {state.editing && state.shown !== undefined && (
          <StudyEditor
            ref={editor}
            key={state.shown.card.id}
            deck={deck}
            card={state.shown.card}
            revealed={state.revealed}
            session={session}
          />
        )}
        <Toaster />
      </div>
    </ChatContext>
  );
}

function TopBar({
  deck,
  session,
  state,
  onUndo,
  onEdit,
  onLeave,
  chatBusy,
}: {
  /** PROTOTYPE (BAN-42): a reply is streaming, so Edit waits. */
  chatBusy: boolean;
  deck: Deck;
  session: StudySession;
  state: StudyState;
  onUndo: () => void;
  onEdit: () => void;
  /** Leaving: "away" to the deck page, else something else shows, or nothing happens. */
  onLeave: () => "summary" | "away" | "stay";
}) {
  return (
    // Named, it stays above the Card's text that slides under it while the editor opens or closes.
    // It holds the top safe-area inset itself, so it ends 3.5 rem below it however far the page has scrolled.
    <header className="sticky top-0 z-10 grid h-[calc(3.5rem+env(safe-area-inset-top))] grid-cols-[1fr_auto_1fr] items-center gap-2 bg-background/95 px-2 pt-[env(safe-area-inset-top)] backdrop-blur [view-transition-name:study-top] sm:px-4">
      <Button
        variant="ghost"
        size="icon"
        className="rounded-full text-foreground no-underline"
        aria-label="Back to deck"
        title="Back to deck (Esc)"
        render={
          <Link
            to="/decks/$deckId"
            params={{ deckId: deck.id }}
            onClick={(event) => {
              if (onLeave() !== "away") event.preventDefault();
            }}
            // A click that closes the editor leaves no focus behind, so Space
            // still reveals and Enter doesn't follow the link.
            onMouseDown={(event) => event.preventDefault()}
          />
        }
        nativeButton={false}
      >
        <X aria-hidden className="size-5" />
      </Button>
      <span className="max-w-[50vw] truncate text-center text-sm font-medium text-muted-foreground">
        {deck.name}
      </span>
      <div className="flex items-center justify-end gap-1 sm:gap-2">
        {state.phase === "card" && <WriteToggle session={session} state={state} />}
        {state.phase === "card" && (
          // Open, it stays as it was: the editor it opened is in front.
          <EditButton disabled={(!state.editable || chatBusy) && !state.editing} onClick={onEdit} />
        )}
        {state.rated > 0 && (
          <span className="hidden text-sm text-muted-foreground tabular-nums sm:inline">
            {state.rated} rated
          </span>
        )}
        <Button
          variant="ghost"
          className="h-11 min-w-11 gap-1.5 rounded-full px-3 lg:h-9 lg:min-w-9"
          disabled={
            !state.undoable ||
            state.undoing ||
            state.saving !== undefined ||
            state.editing ||
            state.skipping ||
            state.refreshing
          }
          onClick={onUndo}
          // A click leaves no focus behind, so Space still reveals the next Card.
          onMouseDown={(event) => event.preventDefault()}
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
  // Write-and-grade before the reveal: a tap on the Card reveals nothing.
  const writing = state.mode === "write" && !state.revealed;
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
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- in self-rate the whole Card is a tap target; Space / Enter and Show answer reveal by keyboard.
    <div
      onClick={onClick}
      className={cn(
        "mx-auto flex w-full flex-1 flex-col px-6 pt-6 pb-10 sm:px-10 lg:pt-12",
        state.grade === undefined ? "max-w-2xl" : GRADED_WIDTH,
        !state.revealed && !writing && "cursor-pointer",
        // From 1024 px the preview beside the editor is the Card, moved there.
        state.editing && "lg:invisible lg:**:[view-transition-name:none]!",
        // A Formula shows it can be copied: the pointer, and a dashed outline on hover.
        state.revealed &&
          "[&_[data-formula]]:cursor-pointer [&_[data-formula]]:rounded-md [&_[data-formula]]:outline-offset-2 [&_[data-formula]:hover]:outline-1 [&_[data-formula]:hover]:outline-primary/60 [&_[data-formula]:hover]:outline-dashed",
      )}
    >
      <CardText
        key={`${card.id}-front`}
        text={card.front}
        interactive={state.revealed}
        className={cn(
          "font-medium tracking-[-0.015em] [view-transition-name:card-front]",
          state.revealed
            ? "text-xl leading-snug text-muted-foreground lg:text-2xl"
            : "text-[1.85rem] leading-tight lg:text-[2.6rem]",
        )}
      />
      {state.revealed && state.grade !== undefined ? (
        <GradedCard session={session} state={state} grade={state.grade} />
      ) : state.revealed ? (
        <>
          <div
            aria-hidden
            className="my-6 h-px w-16 bg-border [view-transition-name:card-rule] lg:my-8"
          />
          <CardText
            key={`${card.id}-back`}
            text={card.back}
            interactive
            className="text-lg leading-relaxed [view-transition-name:card-back] lg:text-xl"
          />
        </>
      ) : writing ? (
        <AnswerEditor key={card.id} session={session} state={state} />
      ) : (
        <p className="mt-8 text-sm text-muted-foreground">Tap anywhere to reveal</p>
      )}
    </div>
  );
}

/** PROTOTYPE (BAN-42): the dock's height as `--dock-h`, so the chat's sheet sits on it. */
function useDockHeight() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el === null || typeof ResizeObserver === "undefined") return () => {};
    const root = document.documentElement;
    const observer = new ResizeObserver(() => {
      root.style.setProperty("--dock-h", `${el.offsetHeight}px`);
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--dock-h");
    };
  }, []);
  return ref;
}

export function Dock({
  session,
  state,
  room = false,
}: {
  session: StudySession;
  state: StudyState;
  /** PROTOTYPE (BAN-42): the chat is live, so from 1024 px it makes room for its sheet. */
  room?: string | false;
}) {
  const intervals = state.shown?.intervals;
  const dock = useDockHeight();
  return (
    <div
      ref={dock}
      className={cn(
        "sticky bottom-0 z-10 border-t bg-background/95 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur [view-transition-name:study-dock]",
        // PROTOTYPE (BAN-42): below 1024 px it steps aside while the chat's input has the focus.
        "max-lg:[body:has([data-chat-composer]:focus-within)_&]:hidden",
        room,
        // From 1024 px it sinks away while the editor is open beside the Card.
        state.editing && "lg:hidden",
      )}
    >
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-2 px-3 pt-3 sm:px-6">
        {/* In the dock, not above the Front, so the Card doesn't move when it comes back. A
            Rating that failed leaves the fresh Intervals it describes; their own failure doesn't. */}
        {state.progressReset &&
          (state.failure === undefined || state.failure === RATE_FAILED) &&
          !state.refreshing && <ResetNote turning={state.turning} />}
        {state.undone && state.failure === undefined && (
          <p className="text-center text-xs font-medium text-muted-foreground">
            Back from Undo: rate it again
          </p>
        )}
        {state.failure !== undefined && (
          <div role="alert" className="flex items-center gap-2 px-1 text-sm text-destructive">
            <AlertCircle aria-hidden className="size-4 shrink-0" />
            <span className="flex-1">{state.failure}</span>
            <Button
              variant="outline"
              className={cn(PILL, "h-11 border-destructive/40 text-destructive lg:h-8 lg:px-3")}
              disabled={state.saving !== undefined || state.refreshing}
              onClick={() => session.retry()}
            >
              Try again
            </Button>
          </div>
        )}
        {state.dontKnow ? (
          <DontKnowDock session={session} state={state} />
        ) : !state.revealed && state.mode === "write" ? (
          <WriteDock session={session} state={state} />
        ) : state.revealed && state.grade !== undefined ? (
          <GradedRatings session={session} state={state} grade={state.grade} />
        ) : state.revealed ? (
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
                <span
                  // A reset Card's Intervals turn over one by one as the dock comes back, once.
                  style={state.turning ? { viewTransitionName: `interval-${rating}` } : undefined}
                  className="flex h-7 items-center text-lg font-semibold tabular-nums [view-transition-class:interval]"
                >
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
                  className="absolute top-1.5 right-2 hidden font-sans text-[0.65rem] text-muted-foreground lg:block"
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

/**
 * The end of the Session without a summary: done with no Rating standing,
 * nothing to study, or Banki out of reach. Exported for its tests.
 */
export function End({
  deck,
  state,
  onRetry,
  onMore,
}: {
  deck: Deck;
  state: StudyState;
  onRetry: () => void;
  onMore: () => void;
}) {
  // Fetched afresh as the end shows, so the batch named is the one the next Card comes by.
  const newCardBatch = useQuery(settingsQueryOptions()).data?.settings.newCardBatch;
  const offer = state.phase === "done" ? moreOffer(state.newHeld, newCardBatch) : undefined;
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
      {offer !== undefined && (
        <p className="-mt-2 text-balance text-muted-foreground tabular-nums">{offer.waiting}</p>
      )}
      {state.phase === "unreachable" ? (
        <Button className={cn(PILL, "h-12 px-7 text-base lg:h-11")} onClick={onRetry}>
          Try again
        </Button>
      ) : (
        <div className="flex flex-wrap justify-center gap-3">
          {offer !== undefined && (
            <Button
              className={cn(PILL, "h-12 px-7 text-base tabular-nums lg:h-11")}
              disabled={state.loadingMore}
              onClick={onMore}
            >
              {state.loadingMore && (
                <LoaderCircle
                  aria-hidden
                  className="size-4 animate-spin motion-reduce:animate-none"
                />
              )}
              {offer.action}
            </Button>
          )}
          <Button
            variant={offer === undefined ? "default" : "outline"}
            className={cn(
              offer === undefined ? PILL : OUTLINE_PILL,
              "h-12 px-7 text-base no-underline lg:h-11",
              offer === undefined ? "text-primary-foreground" : "text-foreground",
            )}
            render={<Link to="/decks/$deckId" params={{ deckId: deck.id }} />}
            nativeButton={false}
          >
            Back to deck
          </Button>
        </div>
      )}
    </div>
  );
}
