import { RATINGS, type Rating } from "@banki/shared";
import { Link } from "@tanstack/react-router";
import { AlertCircle, Check, LoaderCircle, Sparkles } from "lucide-react";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { CardText, type Highlight } from "@/components/cards/card-text";
import { PILL } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import {
  FAILURE_MESSAGES,
  type GradeActions,
  type GradeProto,
  type GradeResult,
  shownTexts,
} from "@/components/study/grade-proto";
import { RATING_KEYS, RATING_LABELS, type StudyState, formatInterval } from "@/lib/study";
import { cn } from "@/lib/utils";

// PROTOTYPE (BAN-40), Variant d, "Margin": the Card keeps its reading column
// (Your answer, then the Back), and from 1024 px the Grader writes in a margin
// beside it, like a marker on an essay: each mistake's note level with its
// mistake, and the Feedback level with the Back it is about. The margin is
// there from Check, so the column never moves when the result lands. Below
// 1024 px there is no margin: the Feedback, with the notes, comes after the
// Back, at the end of the page, so landing only lengthens it. In the dock the
// suggested rating is filled in the accent; a selection before it is ringed
// in ink, and a Confirm callout rises over the ratings above it.

export const REVEALED_WIDTH = "max-w-2xl lg:max-w-6xl";

const LABEL = "text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase";

type Mistake = GradeResult["mistakes"][number];

/** A mistake's tag, after its last mark: the number its margin note carries. */
const tag = (h: Highlight) =>
  h.kind === "mistake" ? (
    <span
      key={`tag-${h.n}`}
      aria-label={`note ${h.n}`}
      className="mx-0.5 inline-flex h-[1.15rem] min-w-[1.15rem] -translate-y-px items-center justify-center rounded-[0.3rem] bg-destructive px-1 align-middle font-sans text-[0.65rem] font-semibold text-white"
    >
      {h.n}
    </span>
  ) : null;

const MISTAKE_MARKS =
  "[&_mark[data-highlight=mistake]]:bg-destructive/10 [&_mark[data-highlight=mistake]]:text-inherit [&_mark[data-highlight=mistake]]:shadow-[inset_0_-2px_0_var(--destructive)] [&_mark[data-highlight=mistake]]:[box-decoration-break:clone] [&_mark[data-highlight=mistake]]:rounded-t-[0.2em]";
const MISSING_MARKS =
  "[&_mark[data-highlight=missing]]:bg-primary/15 [&_mark[data-highlight=missing]]:text-inherit [&_mark[data-highlight=missing]]:[box-decoration-break:clone] [&_mark[data-highlight=missing]]:rounded-[0.2em] [&_mark[data-highlight=missing]]:underline [&_mark[data-highlight=missing]]:decoration-primary [&_mark[data-highlight=missing]]:decoration-dashed [&_mark[data-highlight=missing]]:underline-offset-[0.3em]";

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
  const answer = useRef<HTMLDivElement>(null);
  return (
    <>
      <div
        aria-hidden
        className="my-6 h-px w-16 bg-border [view-transition-name:card-rule] lg:my-8"
      />
      <div className="grid gap-x-12 gap-y-8 lg:grid-cols-[minmax(0,1fr)_19rem] xl:grid-cols-[minmax(0,1fr)_22rem]">
        <section aria-label="Your answer" className="flex min-w-0 flex-col gap-2">
          <div className="flex min-h-5 items-center justify-between gap-2">
            <h2 className={LABEL}>Your answer</h2>
            {result && result.mistakes.length > 0 && (
              <span className="text-xs font-medium text-destructive">
                {result.mistakes.length} {result.mistakes.length === 1 ? "mistake" : "mistakes"}
                <span className="lg:hidden"> · notes below</span>
              </span>
            )}
          </div>
          <div
            ref={answer}
            className="rounded-xl border border-dashed bg-muted/50 px-4 py-3 lg:px-5 lg:py-4"
          >
            <CardText
              text={state.written ?? ""}
              interactive
              highlights={result?.mistakes}
              after={tag}
              className={cn("text-base leading-relaxed lg:text-lg", MISTAKE_MARKS)}
            />
          </div>
        </section>
        {/* The margin beside the answer: each note level with its mistake. */}
        <MarginNotes
          key={state.shown?.card.id}
          answer={answer}
          mistakes={result?.mistakes ?? []}
          status={proto.status}
        />
        <section aria-label="Answer" className="flex min-w-0 flex-col gap-2">
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
        <aside aria-label="Feedback" className="flex min-w-0 flex-col gap-2">
          <div className="flex min-h-5 items-center gap-2">
            <h2 className={LABEL}>Feedback</h2>
          </div>
          <Feedback proto={proto} grade={grade} />
        </aside>
      </div>
    </>
  );
}

/** From 1024 px: the notes in the margin, each as close to level with its mistake as the one above allows. */
function MarginNotes({
  answer,
  mistakes,
  status,
}: {
  answer: React.RefObject<HTMLDivElement | null>;
  mistakes: readonly Mistake[];
  status: GradeProto["status"];
}) {
  const box = useRef<HTMLDivElement>(null);
  const [gaps, setGaps] = useState<number[]>([]);
  useLayoutEffect(() => {
    const margin = box.current;
    const text = answer.current;
    if (margin === null || text === null || mistakes.length === 0) return () => {};
    const place = () => {
      const top = margin.getBoundingClientRect().top;
      const notes = [...margin.querySelectorAll<HTMLElement>("[data-note]")];
      let y = 0;
      const next: number[] = [];
      mistakes.forEach((m, i) => {
        const mark = text.querySelector<HTMLElement>(
          `mark[data-highlight=mistake][data-n="${m.n}"]`,
        );
        const want = mark === null ? y : mark.getBoundingClientRect().top - top - 6;
        const gap = Math.max(i === 0 ? 0 : 8, want - y);
        next.push(gap);
        y += gap + (notes[i]?.offsetHeight ?? 0);
      });
      setGaps((old) => (old.join() === next.join() ? old : next));
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(text);
    return () => observer.disconnect();
  }, [answer, mistakes]);
  return (
    <div ref={box} className="hidden min-w-0 flex-col lg:flex">
      {status === "grading" && (
        <p className="mt-9 flex items-center gap-2 border-l-2 border-dashed border-border pl-3 text-sm text-muted-foreground">
          Notes on your answer go here.
        </p>
      )}
      {status === "graded" && mistakes.length === 0 && (
        <p className="mt-9 border-l-2 border-border pl-3 text-sm text-muted-foreground">
          Nothing wrong in your answer.
        </p>
      )}
      {mistakes.map((m, i) => (
        <Note key={m.n} mistake={m} style={{ marginTop: gaps[i] ?? (i === 0 ? 0 : 8) }} />
      ))}
    </div>
  );
}

function Note({ mistake, style }: { mistake: Mistake; style?: React.CSSProperties }) {
  return (
    <div
      data-note
      role="note"
      style={style}
      className="flex gap-2.5 border-l-2 border-destructive py-0.5 pl-3"
    >
      <span className="mt-0.5 inline-flex h-[1.15rem] min-w-[1.15rem] shrink-0 items-center justify-center rounded-[0.3rem] bg-destructive px-1 text-[0.65rem] font-semibold text-white">
        {mistake.n}
      </span>
      <CardText text={mistake.note} className="min-w-0 text-sm leading-relaxed" />
    </div>
  );
}

/** The Feedback (with the notes, below 1024 px), its place held while the Grader works, or the failure. */
function Feedback({ proto, grade }: { proto: GradeProto; grade: GradeActions }) {
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
    <div className="flex flex-col gap-4 rounded-xl border bg-card p-4">
      <p className="flex items-center gap-2 text-sm">
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
      {result.mistakes.length > 0 && (
        <div className="flex flex-col gap-3 border-t pt-4 lg:hidden">
          <h3 className={LABEL}>Notes on your answer</h3>
          {result.mistakes.map((m) => (
            <Note key={m.n} mistake={m} />
          ))}
        </div>
      )}
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
      <p className="flex min-h-5 items-center justify-center gap-1.5 text-center text-xs font-medium text-muted-foreground">
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
