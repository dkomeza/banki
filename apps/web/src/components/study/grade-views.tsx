import { RATINGS } from "@banki/shared";
import { Link } from "@tanstack/react-router";
import { AlertCircle, Check, KeyRound, LoaderCircle, RotateCcw } from "lucide-react";
import { CardText, type Highlight } from "@/components/cards/card-text";
import {
  FAILURE_MESSAGES,
  type GradeActions,
  type GradeProto,
  shownTexts,
} from "@/components/study/grade-proto";
import { RATING_KEYS, RATING_LABELS, type StudyState, formatInterval } from "@/lib/study";
import { cn } from "@/lib/utils";

// PROTOTYPE (BAN-40), Variant e, "Slip": the Written answer comes back like a
// marked test. The Back comes first (on the left from 768 px, on top on a
// phone), and beside it, or under it, the answer on a paper slip that the
// Grader marks: a stamp in its corner with the suggested Rating (an empty
// dashed one while it marks), each mistake circled in red with its number,
// and at the slip's foot, on ruled lines, the marker's note: the Feedback,
// then the numbered notes. The slip is the only thing that changes when the
// result lands, and nothing sits under it, so nothing moves. In the dock a
// fifth cell holds the Grader's action: Confirm a selection while it marks,
// Take the suggestion (Enter) once it is in, or Try again / Settings after a
// failure.

export const REVEALED_WIDTH = "max-w-2xl md:max-w-5xl";

const LABEL = "text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase";

/** Ruled lines, 2 rem apart, as the answer editor's sheet. */
const RULED =
  "bg-[repeating-linear-gradient(to_bottom,transparent_0,transparent_calc(2rem-1px),var(--border)_calc(2rem-1px),var(--border)_2rem)]";

/** A mistake's number in the red pen, after its circled mark. */
const number = (h: Highlight) =>
  h.kind === "mistake" ? (
    <sup
      key={`n-${h.n}`}
      aria-label={`note ${h.n}`}
      className="ml-0.5 font-sans text-[0.7rem] font-bold text-destructive"
    >
      {h.n}
    </sup>
  ) : null;

export function GradedCard({
  state,
  proto,
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
      <div className="grid items-start gap-8 md:grid-cols-2 md:gap-10">
        <section aria-label="Answer" className="flex min-w-0 flex-col gap-2">
          <div className="flex min-h-5 items-center justify-between gap-2">
            <h2 className={LABEL}>Answer</h2>
            {result && result.missing.length > 0 && (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <span aria-hidden className="h-1.5 w-4 rounded-full bg-primary/40" />
                Missing from yours
              </span>
            )}
          </div>
          <CardText
            text={back}
            interactive
            highlights={result?.missing}
            className="slip-highlighter text-lg leading-relaxed [view-transition-name:card-back] lg:text-xl"
          />
        </section>
        <Slip key={state.shown?.card.id} state={state} proto={proto} />
      </div>
    </>
  );
}

/** The Written answer on its slip, marked: the stamp, the circled mistakes, and the marker's note. */
function Slip({ state, proto }: { state: StudyState; proto: GradeProto }) {
  const result = proto.status === "graded" ? proto.result : undefined;
  return (
    <section
      aria-label="Your answer, marked"
      className="relative flex min-w-0 flex-col rounded-sm border bg-card shadow-[0_1px_0_var(--border),0_8px_24px_-12px_rgb(0_0_0/0.25)] md:-rotate-[0.4deg]"
    >
      <Stamp proto={proto} />
      <div className="flex flex-col gap-2 px-5 pt-4 pb-5 pr-24">
        <h2 className={LABEL}>Your answer</h2>
        <CardText
          text={state.written ?? ""}
          interactive
          highlights={result?.mistakes}
          after={number}
          className="text-base leading-relaxed lg:text-lg [&_mark[data-highlight=mistake]]:rounded-[45%] [&_mark[data-highlight=mistake]]:bg-transparent [&_mark[data-highlight=mistake]]:px-1 [&_mark[data-highlight=mistake]]:text-inherit [&_mark[data-highlight=mistake]]:outline-[1.5px] [&_mark[data-highlight=mistake]]:outline-destructive [&_mark[data-highlight=mistake]]:outline-solid [&_mark[data-highlight=mistake]]:[box-decoration-break:clone]"
        />
      </div>
      <MarkersNote proto={proto} />
    </section>
  );
}

/** The stamp in the slip's corner: dashed and empty while marking, then the suggested Rating. */
function Stamp({ proto }: { proto: GradeProto }) {
  const ring =
    "absolute top-3 right-3 flex size-[4.5rem] flex-col items-center justify-center rounded-full border-2 text-center leading-none";
  if (proto.status === "grading") {
    return (
      <div aria-hidden className={cn(ring, "border-dashed border-border text-muted-foreground")}>
        <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />
        <span className="mt-1 text-[0.6rem] font-semibold tracking-[0.1em] uppercase">Marking</span>
      </div>
    );
  }
  if (proto.status === "failed") {
    return (
      <div aria-hidden className={cn(ring, "border-dashed border-border text-muted-foreground")}>
        <span className="text-[0.6rem] font-semibold tracking-[0.1em] uppercase">Not</span>
        <span className="text-[0.6rem] font-semibold tracking-[0.1em] uppercase">marked</span>
      </div>
    );
  }
  const rating = proto.result?.rating;
  if (rating === undefined) return null;
  return (
    <div
      className={cn(
        ring,
        "-rotate-12 border-primary text-primary shadow-[inset_0_0_0_3px_var(--card),inset_0_0_0_4px_var(--primary)]",
      )}
    >
      <span className="text-[0.55rem] font-semibold tracking-[0.12em] uppercase">Suggests</span>
      <span className="mt-1 text-base font-bold tracking-[0.04em] uppercase">
        {RATING_LABELS[rating]}
      </span>
    </div>
  );
}

/** The slip's foot on ruled lines: the Feedback and the notes, or lines waiting, or the failure. */
function MarkersNote({ proto }: { proto: GradeProto }) {
  const foot = "flex min-h-[8rem] flex-col border-t border-dashed px-5 pt-[0.4rem] pb-3";
  if (proto.status === "failed" && proto.failure) {
    return (
      <div role="alert" className={cn(foot, RULED)}>
        <p className="flex items-start gap-2 text-sm leading-[2rem] text-destructive">
          <AlertCircle aria-hidden className="mt-2 size-4 shrink-0" />
          {FAILURE_MESSAGES[proto.failure]}
        </p>
        <p className="text-sm leading-[2rem] text-muted-foreground">
          Compare it with the Answer and rate it yourself.
        </p>
      </div>
    );
  }
  if (proto.status === "grading") {
    return (
      <div role="status" aria-label="Marking your answer" className={cn(foot, RULED)}>
        <p className="text-sm leading-[2rem] text-muted-foreground">The marker's note goes here…</p>
      </div>
    );
  }
  const result = proto.result;
  if (result === undefined) return null;
  return (
    <div className={cn(foot, "gap-3 pt-3 pb-4")}>
      <h3 className={LABEL}>Marker's note</h3>
      <CardText
        text={result.feedback}
        interactive
        className="text-[0.95rem] leading-relaxed [&_ol]:flex [&_ol]:flex-col [&_ol]:gap-2"
      />
      {result.mistakes.length > 0 && (
        <ol className="flex flex-col gap-1.5 border-t border-dashed pt-3">
          {result.mistakes.map((m) => (
            <li key={m.n} className="flex gap-2 text-destructive">
              <span className="text-sm leading-relaxed font-bold">{m.n}</span>
              <CardText
                text={m.note}
                className="min-w-0 text-sm leading-relaxed text-destructive italic"
              />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** The dock after Check: the four ratings, then the Grader's action in a fifth cell. */
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
  const cell =
    "relative flex h-[4.5rem] flex-col items-center justify-center gap-0.5 outline-none transition-colors focus-visible:z-10 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none lg:h-16";
  return (
    <div className="grid grid-cols-[repeat(4,minmax(0,1fr))_minmax(0,1.15fr)] rounded-2xl border bg-card">
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
              cell,
              "hover:bg-muted disabled:opacity-50",
              i > 0 && "border-l",
              i === 0 && "rounded-l-2xl",
              selected && "bg-muted shadow-[inset_0_-3px_0_var(--foreground)]",
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
                "rounded-full border border-transparent px-1.5 text-xs font-medium text-muted-foreground",
                rating === "again" && "text-destructive",
                selected && "text-foreground",
                isSuggested && "-rotate-6 border-primary font-semibold text-primary",
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
        );
      })}
      <GraderCell state={state} proto={proto} grade={grade} className={cell} />
    </div>
  );
}

/** The fifth cell: Confirm, Take the suggestion, Try again or Settings. */
function GraderCell({
  state,
  proto,
  grade,
  className,
}: {
  state: StudyState;
  proto: GradeProto;
  grade: GradeActions;
  className: string;
}) {
  const base = cn(
    className,
    "rounded-r-2xl border-l px-1 text-center [&_svg]:size-4",
    "bg-primary text-primary-foreground hover:bg-primary/90",
  );
  const sub = "text-[0.7rem] leading-tight font-medium text-primary-foreground/85";
  const enter = (
    <kbd
      aria-hidden
      className="absolute top-1.5 right-2 hidden font-sans text-[0.65rem] text-primary-foreground/75 lg:block"
    >
      Enter
    </kbd>
  );
  if (proto.status === "failed") {
    if (proto.failure === "no_api_key") {
      return (
        <Link
          to="/settings"
          className={cn(base, "bg-card text-foreground no-underline hover:bg-muted")}
        >
          <KeyRound aria-hidden />
          <span className="text-sm font-semibold">Settings</span>
          <span className="text-[0.7rem] leading-tight text-muted-foreground">add a key</span>
        </Link>
      );
    }
    return (
      <button
        type="button"
        onClick={grade.retry}
        onMouseDown={(event) => event.preventDefault()}
        className={cn(base, "bg-card text-foreground hover:bg-muted")}
      >
        <RotateCcw aria-hidden />
        <span className="text-sm font-semibold">Try again</span>
        <span className="text-[0.7rem] leading-tight text-muted-foreground">mark it</span>
      </button>
    );
  }
  if (proto.status === "grading") {
    const picked = proto.selected;
    return (
      <button
        type="button"
        disabled={picked === undefined || !state.ratable}
        onClick={grade.confirm}
        onMouseDown={(event) => event.preventDefault()}
        className={cn(
          base,
          picked === undefined && "bg-muted text-muted-foreground disabled:opacity-100",
        )}
      >
        <Check aria-hidden />
        <span className="text-sm font-semibold">Confirm</span>
        <span className={cn(sub, picked === undefined && "text-muted-foreground")}>
          {picked === undefined ? "pick a rating" : RATING_LABELS[picked]}
        </span>
        {picked !== undefined && enter}
      </button>
    );
  }
  const take = proto.selected ?? proto.result?.rating;
  if (take === undefined) return null;
  return (
    <button
      type="button"
      disabled={!state.ratable}
      onClick={grade.confirm}
      onMouseDown={(event) => event.preventDefault()}
      className={cn(base, "disabled:opacity-50")}
    >
      <Check aria-hidden />
      <span className="text-sm font-semibold">Take</span>
      <span className={sub}>{RATING_LABELS[take]}</span>
      {enter}
    </button>
  );
}
