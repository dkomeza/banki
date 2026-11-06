import { RATINGS, type Rating } from "@banki/shared";
import { Link } from "@tanstack/react-router";
import { AlertCircle, Check, ChevronUp, LoaderCircle, Sparkles } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { CardText } from "@/components/cards/card-text";
import { PILL } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import {
  FAILURE_MESSAGES,
  type GradeActions,
  type GradeProto,
  type GradeResult,
  shownTexts,
} from "@/components/study/grade-proto";
import { MISTAKE_MARKS, type Shown, useMistakeMarks } from "@/components/study/mistake-marks";
import { RATING_KEYS, RATING_LABELS, type StudyState, formatInterval } from "@/lib/study";
import { cn } from "@/lib/utils";

// PROTOTYPE (BAN-40), Variant k, "Margin, one voice": d's Margin, with
// everything the Grader says in one panel that never leaves the screen.
// A mistake is marked as in d, with no number; hovering it (or tapping it,
// on a phone) puts its note at the top of the Feedback panel, over the
// Feedback, until the pointer moves on. From 1024 px the panel is d's
// margin, held in view (sticky) beside your answer and a long Back. Below
// 1024 px it is a sheet on top of the dock: one line with the suggestion and
// the start of the Feedback, which opens to the whole of it, and which shows
// a mistake's note when you tap the mistake. The dock is otherwise d's.

export const REVEALED_WIDTH = "max-w-2xl lg:max-w-6xl";

const LABEL = "text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase";

type Mistake = GradeResult["mistakes"][number];

const MISSING_MARKS =
  "[&_mark[data-highlight=missing]]:bg-primary/15 [&_mark[data-highlight=missing]]:text-inherit [&_mark[data-highlight=missing]]:[box-decoration-break:clone] [&_mark[data-highlight=missing]]:rounded-[0.2em] [&_mark[data-highlight=missing]]:underline [&_mark[data-highlight=missing]]:decoration-primary [&_mark[data-highlight=missing]]:decoration-dashed [&_mark[data-highlight=missing]]:underline-offset-[0.3em]";

/** The mistake whose note shows, shared by your answer and the panel (in the margin, or on the dock). */
let pointed: { shown: Shown; mistake: Mistake | undefined } = {
  shown: undefined,
  mistake: undefined,
};
const listeners = new Set<() => void>();
const point = (next: typeof pointed) => {
  pointed = next;
  for (const listener of listeners) listener();
};
const usePointed = () =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => pointed,
  );

export function GradedCard({
  state,
  proto,
  grade,
}: {
  state: StudyState;
  proto: GradeProto;
  grade: GradeActions;
}) {
  const { back } = shownTexts(state, proto);
  const result = proto.status === "graded" ? proto.result : undefined;
  return (
    <>
      <div
        aria-hidden
        className="my-6 h-px w-16 bg-border [view-transition-name:card-rule] lg:my-8"
      />
      <div className="grid gap-x-12 gap-y-8 lg:grid-cols-[minmax(0,1fr)_19rem] xl:grid-cols-[minmax(0,1fr)_22rem]">
        <YourAnswer key={state.shown?.card.id} written={state.written ?? ""} result={result} />
        {/* From 1024 px, the margin: the panel, held in view beside your answer and the Back. */}
        <aside
          aria-label="Feedback"
          className="hidden min-w-0 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:block"
        >
          <div className="flex flex-col gap-2 lg:sticky lg:top-[calc(4.5rem+env(safe-area-inset-top))] lg:max-h-[calc(100dvh-14rem)] lg:overflow-y-auto lg:pb-2">
            <div className="flex min-h-5 items-center gap-2">
              <h2 className={LABEL}>Feedback</h2>
            </div>
            {/* Over the Feedback, not above it, so the Feedback never moves. */}
            <div className="relative">
              <PointedNote className="absolute inset-x-0 top-0 z-10 bg-card shadow-lg" />
              <Feedback proto={proto} grade={grade} />
            </div>
          </div>
        </aside>
        <section
          aria-label="Answer"
          className="flex min-w-0 flex-col gap-2 lg:col-start-1 lg:row-start-2"
        >
          <div className="flex min-h-5 items-center justify-between gap-2">
            <h2 className={LABEL}>Answer</h2>
            {result && result.missing.length > 0 && (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <span
                  aria-hidden
                  className="h-3 w-4 rounded-[0.2em] border-b border-dashed border-primary bg-primary/15"
                />
                Missing from yours
              </span>
            )}
          </div>
          <CardText
            text={back}
            interactive
            highlights={result?.missing}
            className={cn(
              "text-lg leading-relaxed [view-transition-name:card-back] lg:text-xl",
              MISSING_MARKS,
            )}
          />
        </section>
      </div>
    </>
  );
}

/** Your answer, its mistakes marked; the one pointed at shows its note in the panel. */
function YourAnswer({ written, result }: { written: string; result: GradeResult | undefined }) {
  const box = useRef<HTMLDivElement>(null);
  const mistakes = result?.mistakes;
  const { shown } = useMistakeMarks(box);
  useEffect(() => {
    point({ shown, mistake: mistakes?.find((m) => m.n === shown?.n) });
  }, [shown, mistakes]);
  useEffect(() => () => point({ shown: undefined, mistake: undefined }), []);
  return (
    <section
      aria-label="Your answer"
      className="flex min-w-0 flex-col gap-2 lg:col-start-1 lg:row-start-1"
    >
      <div className="flex min-h-5 items-center justify-between gap-2">
        <h2 className={LABEL}>Your answer</h2>
        {mistakes && mistakes.length > 0 && (
          <span className="text-xs font-medium text-destructive">
            {mistakes.length} {mistakes.length === 1 ? "mistake" : "mistakes"}
            <span className="font-normal text-muted-foreground">
              <span className="lg:hidden"> · tap one, its note shows below</span>
              <span className="hidden lg:inline"> · point at one, its note shows beside</span>
            </span>
          </span>
        )}
      </div>
      <div
        ref={box}
        className="rounded-xl border border-dashed bg-muted/50 px-4 py-3 lg:px-5 lg:py-4"
      >
        <CardText
          text={written}
          highlights={mistakes}
          className={cn("text-base leading-relaxed lg:text-lg", MISTAKE_MARKS)}
        />
      </div>
    </section>
  );
}

/** At the top of the panel, the note of the mistake pointed at, over the Feedback. */
function PointedNote({ className }: { className?: string }) {
  const { mistake } = usePointed();
  if (mistake === undefined) return null;
  return (
    <div
      role="note"
      aria-live="polite"
      className={cn(
        "flex animate-in flex-col gap-1 rounded-xl border border-destructive/30 bg-[color-mix(in_oklab,var(--destructive)_5%,var(--card))] px-4 py-3 duration-150 fade-in-0 slide-in-from-top-1 motion-reduce:animate-none",
        className,
      )}
    >
      <p className="text-[0.7rem] font-semibold tracking-[0.08em] text-destructive uppercase">
        Why it's wrong
      </p>
      <CardText text={mistake.note} className="text-sm leading-relaxed" />
    </div>
  );
}

/** The first paragraph of the Feedback, as plain as a line can be. */
const firstParagraph = (feedback: string) => feedback.split(/\n\s*\n/)[0] ?? feedback;

/**
 * Below 1024 px, the panel as a sheet on top of the dock: a line with the
 * suggestion and the Feedback's start, opening to the whole of it; a
 * mistake tapped shows its note in it.
 */
function DockSheet({ proto, grade }: { proto: GradeProto; grade: GradeActions }) {
  const { mistake } = usePointed();
  const [opened, setOpen] = useState(false);
  // A failure shows open: its Try again, or the way to Settings, is in it.
  const open = opened || proto.status === "failed";
  const result = proto.status === "graded" ? proto.result : undefined;
  return (
    <div className="overflow-hidden rounded-2xl border bg-card lg:hidden">
      <button
        type="button"
        aria-expanded={open}
        data-sheet
        onClick={() => setOpen(!open)}
        onMouseDown={(event) => event.preventDefault()}
        className="flex min-h-11 w-full items-center gap-2 px-4 py-2 text-left text-sm"
      >
        {proto.status === "grading" ? (
          <>
            <LoaderCircle
              aria-hidden
              className="size-4 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none"
            />
            <span className="text-muted-foreground">Grading your answer…</span>
          </>
        ) : result ? (
          <>
            <Sparkles aria-hidden className="size-4 shrink-0 text-primary" />
            <span className="min-w-0 flex-1 truncate text-muted-foreground">
              Suggests{" "}
              <span className="font-semibold text-primary">{RATING_LABELS[result.rating]}</span>
              {!open && <> · {firstParagraph(result.feedback).replace(/[*$\\]/g, "")}</>}
            </span>
          </>
        ) : (
          <>
            <AlertCircle aria-hidden className="size-4 shrink-0 text-destructive" />
            <span className="flex-1 text-muted-foreground">Not graded</span>
          </>
        )}
        <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-xs font-medium text-muted-foreground">
          {open ? "Hide" : "Feedback"}
          <ChevronUp
            aria-hidden
            className={cn("size-4 transition-transform", open && "rotate-180")}
          />
        </span>
      </button>
      {mistake !== undefined && (
        <PointedNote className="mx-2 mb-2 rounded-lg border-destructive/20" />
      )}
      {open && (
        <div className="max-h-[45dvh] overflow-y-auto border-t">
          <Feedback proto={proto} grade={grade} bare />
        </div>
      )}
    </div>
  );
}

/** The Feedback, its place held while the Grader works, or the failure. */
function Feedback({
  proto,
  grade,
  bare = false,
}: {
  proto: GradeProto;
  grade: GradeActions;
  /** Inside the tab, without its own frame. */
  bare?: boolean;
}) {
  if (proto.status === "failed" && proto.failure) {
    return (
      <div role="alert" className="flex flex-col gap-3 rounded-xl border border-destructive/30 p-4">
        <p className="flex items-start gap-2 text-sm leading-relaxed text-destructive">
          <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
          {FAILURE_MESSAGES[proto.failure]}
        </p>
        {proto.failure === "no_api_key" ? (
          <Button
            variant="outline"
            className={cn(PILL, "h-11 self-start no-underline lg:h-9")}
            render={<Link to="/settings" />}
            nativeButton={false}
          >
            Open Settings
          </Button>
        ) : (
          <Button
            variant="outline"
            className={cn(PILL, "h-11 self-start lg:h-9")}
            onClick={grade.retry}
          >
            Try again
          </Button>
        )}
      </div>
    );
  }
  if (proto.status === "grading") {
    return (
      <div
        role="status"
        aria-label="Grading your answer"
        className="flex min-h-36 flex-col gap-3 rounded-xl border border-dashed p-4"
      >
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle
            aria-hidden
            className="size-4 shrink-0 animate-spin motion-reduce:animate-none"
          />
          Reading your answer against the Back…
        </p>
        <span
          aria-hidden
          className="h-2.5 w-11/12 animate-pulse rounded-full bg-muted motion-reduce:animate-none"
        />
        <span
          aria-hidden
          className="h-2.5 w-4/5 animate-pulse rounded-full bg-muted motion-reduce:animate-none"
        />
        <span
          aria-hidden
          className="h-2.5 w-2/3 animate-pulse rounded-full bg-muted motion-reduce:animate-none"
        />
      </div>
    );
  }
  const result = proto.result;
  if (result === undefined) return null;
  return (
    <div className={cn("flex flex-col gap-4 p-4", !bare && "rounded-xl border bg-card")}>
      <p className={cn("flex items-center gap-2 text-sm", bare && "hidden")}>
        <Sparkles aria-hidden className="size-4 shrink-0 text-primary" />
        <span className="text-muted-foreground">
          Suggests{" "}
          <span className="font-semibold text-primary">{RATING_LABELS[result.rating]}</span>
        </span>
      </p>
      <CardText
        text={result.feedback}
        interactive
        className="text-sm leading-relaxed lg:text-[0.95rem] [&_ol]:flex [&_ol]:flex-col [&_ol]:gap-2"
      />
    </div>
  );
}

/** The dock after Check: the four ratings, the suggestion filled, and Confirm over a selection. */
export function GradedRatings({
  state,
  proto,
  grade,
}: {
  state: StudyState;
  proto: GradeProto;
  grade: GradeActions;
}) {
  const intervals = state.shown?.intervals;
  const suggested = proto.status === "graded" ? proto.result?.rating : undefined;
  const confirming = proto.status === "grading" ? proto.selected : undefined;
  return (
    <div className="flex flex-col gap-2">
      <DockSheet key={state.shown?.card.id} proto={proto} grade={grade} />
      {/* Below the sheet, room for Confirm to rise into without covering it. */}
      <p
        className={cn(
          "flex min-h-5 items-center justify-center gap-1.5 text-center text-xs font-medium text-muted-foreground",
          confirming !== undefined && "max-lg:min-h-12",
        )}
      >
        <Hint proto={proto} />
      </p>
      <div className="relative grid grid-cols-4 rounded-2xl border bg-card">
        {confirming !== undefined && (
          <ConfirmCallout rating={confirming} state={state} grade={grade} />
        )}
        {RATINGS.map((rating, i) => {
          const selected = proto.selected === rating;
          const isSuggested = suggested === rating;
          return (
            <button
              key={rating}
              type="button"
              data-rating={rating}
              aria-pressed={proto.status === "grading" ? selected : undefined}
              disabled={!state.ratable}
              onClick={() => grade.tap(rating)}
              aria-label={`${RATING_LABELS[rating]}${intervals ? `, ${formatInterval(intervals[rating], state.previewedAt)}` : ""}${isSuggested ? ", suggested" : ""}`}
              className={cn(
                "relative flex h-[4.5rem] flex-col items-center justify-center gap-0.5 outline-none transition-colors hover:bg-muted focus-visible:z-10 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 lg:h-16",
                i > 0 && "border-l",
                i === 0 && "rounded-l-2xl",
                i === 3 && "rounded-r-2xl",
                isSuggested && "bg-primary text-primary-foreground hover:bg-primary/90",
                selected && "shadow-[inset_0_0_0_2px_var(--foreground)]",
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
                  "inline-flex items-center gap-1 text-xs font-medium text-muted-foreground",
                  rating === "again" && "text-destructive",
                  isSuggested && "text-primary-foreground",
                  selected && !isSuggested && "text-foreground",
                )}
              >
                {isSuggested && <Sparkles aria-hidden className="size-3" />}
                {RATING_LABELS[rating]}
              </span>
              <kbd
                aria-hidden
                className={cn(
                  "absolute top-1.5 right-2 hidden font-sans text-[0.65rem] text-muted-foreground lg:block",
                  isSuggested && "text-primary-foreground/80",
                )}
              >
                {RATING_KEYS[rating]}
              </kbd>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Hint({ proto }: { proto: GradeProto }): ReactNode {
  if (proto.status === "grading") {
    return proto.selected === undefined ? (
      <>
        <LoaderCircle aria-hidden className="size-3.5 animate-spin motion-reduce:animate-none" />
        Grading… pick a rating to confirm it now, or wait for the suggestion
      </>
    ) : (
      <>
        <span className="sr-only">Still grading</span>
      </>
    );
  }
  if (proto.status === "failed") return <>Not graded: rate it yourself</>;
  if (proto.result === undefined) return null;
  return (
    <>
      Tap any rating to save it
      <span className="hidden lg:inline">
        {" "}
        · Enter takes {RATING_LABELS[proto.selected ?? proto.result.rating]}
      </span>
    </>
  );
}

/** Over the ratings, above the one selected before the suggestion: Confirm, with Enter. */
function ConfirmCallout({
  rating,
  state,
  grade,
}: {
  rating: Rating;
  state: StudyState;
  grade: GradeActions;
}) {
  const at = RATINGS.indexOf(rating);
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-full z-20 mb-2 grid grid-cols-4">
      <div
        style={{ gridColumnStart: at + 1 }}
        className={cn(
          "relative flex",
          at === 0 ? "justify-start" : at === 3 ? "justify-end" : "justify-center",
        )}
      >
        <Button
          className={cn(
            PILL,
            "pointer-events-auto h-11 gap-1.5 px-5 whitespace-nowrap shadow-lg lg:h-9",
          )}
          disabled={!state.ratable}
          onClick={grade.confirm}
          onMouseDown={(event) => event.preventDefault()}
        >
          <Check aria-hidden className="size-4" />
          Confirm {RATING_LABELS[rating]}
          <kbd
            aria-hidden
            className="ml-0.5 hidden rounded border border-primary-foreground/30 px-1 font-sans text-[0.65rem] lg:inline"
          >
            Enter
          </kbd>
        </Button>
        <span
          aria-hidden
          className="absolute -bottom-1 left-1/2 size-2.5 -translate-x-1/2 rotate-45 bg-primary"
        />
      </div>
    </div>
  );
}
