import { RATINGS } from "@banki/shared";
import { Link } from "@tanstack/react-router";
import { AlertCircle, ChevronDown, CircleCheck, LoaderCircle, PenLine } from "lucide-react";
import { useState } from "react";
import { CardLine, CardText, type Highlight } from "@/components/cards/card-text";
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

// PROTOTYPE (BAN-40), Variant c, "Compare": the Grader's Feedback leads,
// right under the Front, in a box of fixed height from Check (Read all opens
// it); under it Your answer and the Back sit side by side from 768 px, to
// compare line by line, stacked on a phone. A mistake gets the red pen: its
// note written inline right after it, always showing. The missing part of
// the Back is run over with a highlighter. The dock is the ratings alone:
// the suggestion is ringed in the accent, and before it a tap selects
// (the button then reads "Confirm") and a second tap, or Enter, saves.

export const REVEALED_WIDTH = "max-w-2xl md:max-w-5xl";

const LABEL = "text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase";

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
      <Feedback key={state.shown?.card.id} proto={proto} grade={grade} />
      <div className="mt-6 grid gap-6 md:grid-cols-2 md:gap-0 md:divide-x md:rounded-2xl md:border lg:mt-8">
        <section aria-label="Your answer" className="flex min-w-0 flex-col gap-2 md:p-6">
          <div className="flex min-h-5 items-center justify-between gap-2">
            <h2 className={LABEL}>Your answer</h2>
            {result && result.mistakes.length > 0 && (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-destructive">
                <PenLine aria-hidden className="size-3.5" />
                {result.mistakes.length} {result.mistakes.length === 1 ? "mistake" : "mistakes"}
              </span>
            )}
          </div>
          <Written text={state.written ?? ""} result={result} />
        </section>
        <section aria-label="Answer" className="flex min-w-0 flex-col gap-2 md:p-6">
          <div className="flex min-h-5 items-center justify-between gap-2">
            <h2 className={LABEL}>Answer</h2>
            {result && result.missing.length > 0 && (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <span aria-hidden className="highlighter-swatch h-3 w-4" />
                Missing from yours
              </span>
            )}
          </div>
          <CardText
            text={back}
            interactive
            highlights={result?.missing}
            className="text-lg leading-relaxed [view-transition-name:card-back] lg:text-xl highlighter"
          />
        </section>
      </div>
    </>
  );
}

/** The Written answer, a mistake's note in red right after it. */
function Written({ text, result }: { text: string; result: GradeResult | undefined }) {
  const notes = new Map(result?.mistakes.map((m) => [m.n, m.note]));
  const pen = (h: Highlight) => {
    const note = notes.get(h.n);
    if (h.kind !== "mistake" || note === undefined) return null;
    return (
      <span key={`pen-${h.n}`} className="ml-1 text-[0.85em] leading-snug text-destructive italic">
        ←{" "}
        <CardLine
          text={note}
          className="!inline !overflow-visible !whitespace-normal [overflow-wrap:anywhere]"
        />
      </span>
    );
  };
  return (
    <CardText
      text={text}
      interactive
      highlights={result?.mistakes}
      after={pen}
      className="text-base leading-relaxed lg:text-lg [&_mark[data-highlight=mistake]]:bg-transparent [&_mark[data-highlight=mistake]]:text-inherit [&_mark[data-highlight=mistake]]:line-through [&_mark[data-highlight=mistake]]:decoration-destructive [&_mark[data-highlight=mistake]]:decoration-2 [&_mark[data-highlight=mistake]_.katex]:shadow-[inset_0_-2px_0_var(--destructive)]"
    />
  );
}

/** The Feedback, first: one height from Check, the lines sketched while the Grader works. */
function Feedback({ proto }: { proto: GradeProto; grade: GradeActions }) {
  const [all, setAll] = useState(false);
  const box = cn(
    "relative mt-6 flex flex-col gap-2 rounded-2xl bg-primary/6 px-4 py-3 lg:mt-8 lg:px-6 lg:py-4",
    !all && "h-[9.5rem] overflow-hidden lg:h-[8.5rem]",
  );
  if (proto.status === "graded" && proto.result) {
    const { feedback, rating } = proto.result;
    return (
      <section aria-label="Feedback" className={box}>
        <div className="flex items-center justify-between gap-2">
          <h2 className={cn(LABEL, "text-primary")}>Feedback · suggests {RATING_LABELS[rating]}</h2>
        </div>
        <CardText
          text={feedback}
          interactive
          className="text-base leading-relaxed [&_ol]:flex [&_ol]:flex-col [&_ol]:gap-1.5"
        />
        {!all ? (
          <div className="absolute inset-x-0 bottom-0 flex h-14 items-end justify-end bg-gradient-to-t from-[color-mix(in_oklab,var(--primary)_6%,var(--background))] from-40% to-transparent px-3 pb-1.5 lg:px-4">
            <button
              type="button"
              onClick={() => setAll(true)}
              onMouseDown={(event) => event.preventDefault()}
              className="flex h-11 items-center gap-1 rounded-full px-3 text-sm font-medium text-primary hover:bg-primary/10 lg:h-8"
            >
              Read all
              <ChevronDown aria-hidden className="size-4" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAll(false)}
            className="flex h-11 items-center self-end rounded-full px-3 text-sm font-medium text-primary hover:bg-primary/10 lg:h-8"
          >
            Show less
          </button>
        )}
      </section>
    );
  }
  if (proto.status === "failed") {
    return (
      <section
        aria-label="Feedback"
        className={cn(box, "items-start justify-center bg-muted/60 text-muted-foreground")}
      >
        <h2 className={LABEL}>Feedback</h2>
        <p className="text-base">Not graded. Compare the two below, and rate it yourself.</p>
      </section>
    );
  }
  return (
    <section role="status" aria-label="Grading your answer" className={box}>
      <h2 className={cn(LABEL, "flex items-center gap-2 text-primary")}>
        <LoaderCircle aria-hidden className="size-3.5 animate-spin motion-reduce:animate-none" />
        Grading your answer…
      </h2>
      {["w-11/12", "w-full", "w-3/5"].map((w) => (
        <span
          key={w}
          aria-hidden
          className={cn(
            "mt-1 h-3 animate-pulse rounded-full bg-primary/12 motion-reduce:animate-none",
            w,
          )}
        />
      ))}
    </section>
  );
}

/** The dock after Check: the ratings alone, and above them a failure. */
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
  return (
    <div className="flex flex-col gap-2">
      {proto.status === "failed" && proto.failure && (
        <div role="alert" className="flex items-center gap-2 px-1 text-sm text-destructive">
          <AlertCircle aria-hidden className="size-4 shrink-0" />
          <span className="flex-1">{FAILURE_MESSAGES[proto.failure]}</span>
          {proto.failure === "no_api_key" ? (
            <Button
              variant="outline"
              className={cn(
                PILL,
                "h-11 border-destructive/40 text-destructive no-underline lg:h-8 lg:px-3",
              )}
              render={<Link to="/settings" />}
              nativeButton={false}
            >
              Settings
            </Button>
          ) : (
            <Button
              variant="outline"
              className={cn(PILL, "h-11 border-destructive/40 text-destructive lg:h-8 lg:px-3")}
              onClick={grade.retry}
            >
              Try again
            </Button>
          )}
        </div>
      )}
      <div className="grid grid-cols-4 overflow-hidden rounded-2xl border bg-card">
        {RATINGS.map((rating, i) => {
          const selected = proto.selected === rating;
          const confirming = selected && proto.status === "grading";
          return (
            <button
              key={rating}
              type="button"
              data-rating={rating}
              aria-pressed={proto.status === "grading" ? selected : undefined}
              disabled={!state.ratable}
              onClick={() => (confirming ? grade.confirm() : grade.tap(rating))}
              aria-label={
                confirming
                  ? `Confirm ${RATING_LABELS[rating]}`
                  : `${RATING_LABELS[rating]}${intervals ? `, ${formatInterval(intervals[rating], state.previewedAt)}` : ""}${suggested === rating ? ", suggested" : ""}`
              }
              className={cn(
                "relative flex h-[4.5rem] flex-col items-center justify-center gap-0.5 outline-none transition-colors hover:bg-muted focus-visible:z-10 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 lg:h-16",
                i > 0 && "border-l",
                suggested === rating && "shadow-[inset_0_0_0_2px_var(--primary)]",
                confirming && "bg-primary text-primary-foreground hover:bg-primary/90",
                selected && !confirming && "bg-muted",
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
                  "flex items-center gap-1 text-xs font-medium text-muted-foreground",
                  rating === "again" && "text-destructive",
                  suggested === rating && "text-primary",
                  confirming && "text-primary-foreground",
                )}
              >
                {suggested === rating && <CircleCheck aria-hidden className="size-3.5" />}
                {confirming ? <>Confirm {RATING_LABELS[rating]}</> : RATING_LABELS[rating]}
              </span>
              <kbd
                aria-hidden
                className={cn(
                  "absolute top-1.5 right-2 hidden font-sans text-[0.65rem] text-muted-foreground lg:block",
                  confirming && "text-primary-foreground/80",
                )}
              >
                {confirming ? "Enter" : RATING_KEYS[rating]}
              </kbd>
            </button>
          );
        })}
      </div>
    </div>
  );
}
