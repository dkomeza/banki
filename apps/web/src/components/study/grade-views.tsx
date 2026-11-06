import { RATINGS } from "@banki/shared";
import { Link } from "@tanstack/react-router";
import { AlertCircle, Check, LoaderCircle, Sparkles, X } from "lucide-react";
import { type MouseEvent, useState } from "react";
import { CardLine, CardText, type Highlight } from "@/components/cards/card-text";
import { PILL } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import {
  FAILURE_MESSAGES,
  type GradeActions,
  type GradeProto,
  shownTexts,
} from "@/components/study/grade-proto";
import { RATING_KEYS, RATING_LABELS, type StudyState, formatInterval } from "@/lib/study";
import { cn } from "@/lib/utils";

// PROTOTYPE (BAN-40), Variant f, "Thread": after Check the Card reads as a
// short exchange, one column at every size. Your answer is your message, on
// the right; the Back follows, as the Card has it; then the Grader replies on
// the left, typing while it works. Its reply is the Feedback, then each
// mistake quoted back from your message with its note, the way a reply quotes
// a message, and a tap on a mistake in yours lights up its quote. The reply
// comes last on the page, so landing only lengthens it (and BAN-42's
// follow-up chat would carry on under it). In the dock the suggestion wears a
// small Grader badge; a selection before it turns the ratings into a commit
// bar: the selected Rating, Change, and Confirm.

export const REVEALED_WIDTH = "max-w-2xl";

const LABEL = "text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase";

/** A mistake's number, after its mark in your message. */
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
  grade,
}: {
  state: StudyState;
  proto: GradeProto;
  grade: GradeActions;
}) {
  const { back } = shownTexts(state, proto);
  const result = proto.status === "graded" ? proto.result : undefined;
  const [lit, setLit] = useState<number | undefined>();
  const onClick = (event: MouseEvent) => {
    const mark =
      event.target instanceof Element ? event.target.closest("mark[data-highlight=mistake]") : null;
    if (mark === null) return;
    const n = Number(mark.getAttribute("data-n"));
    setLit(n);
    document.getElementById(`quote-${n}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };
  return (
    <div className="mt-8 flex flex-col gap-6 lg:mt-10">
      {/* Your message. */}
      <section aria-label="Your answer" className="flex flex-col items-end gap-1.5 pl-8 sm:pl-16">
        <h2 className={LABEL}>You</h2>
        {/* oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- PROTOTYPE: a tap on a mistake lights up its quote. */}
        <div
          onClick={onClick}
          className="max-w-full rounded-2xl rounded-tr-sm bg-muted px-4 py-3 lg:px-5"
        >
          <CardText
            text={state.written ?? ""}
            interactive
            highlights={result?.mistakes}
            after={number}
            className="text-base leading-relaxed lg:text-lg [&_mark[data-highlight=mistake]]:cursor-pointer [&_mark[data-highlight=mistake]]:bg-transparent [&_mark[data-highlight=mistake]]:text-inherit [&_mark[data-highlight=mistake]]:underline [&_mark[data-highlight=mistake]]:decoration-destructive [&_mark[data-highlight=mistake]]:decoration-wavy [&_mark[data-highlight=mistake]]:decoration-from-font [&_mark[data-highlight=mistake]]:underline-offset-4 [&_mark[data-highlight=mistake]_.katex]:shadow-[inset_0_-2px_0_var(--destructive)]"
          />
        </div>
      </section>
      {/* The Back, as the Card has it. */}
      <section aria-label="Answer" className="flex flex-col gap-2">
        <div className="flex min-h-5 items-center justify-between gap-2">
          <h2 className={LABEL}>Answer</h2>
          {result && result.missing.length > 0 && (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <span aria-hidden className="h-3 w-4 rounded-[0.2em] bg-primary/15" />
              Missing from yours
            </span>
          )}
        </div>
        <CardText
          text={back}
          interactive
          highlights={result?.missing}
          className="text-lg leading-relaxed [view-transition-name:card-back] lg:text-xl [&_mark[data-highlight=missing]]:text-inherit [&_mark[data-highlight=missing]]:rounded-[0.2em] [&_mark[data-highlight=missing]]:bg-primary/15 [&_mark[data-highlight=missing]]:[box-decoration-break:clone]"
        />
      </section>
      <Reply proto={proto} grade={grade} lit={lit} written={state.written ?? ""} />
    </div>
  );
}

/** The Grader's reply: typing, the Feedback and the quoted mistakes, or the failure. */
function Reply({
  proto,
  grade,
  lit,
  written,
}: {
  proto: GradeProto;
  grade: GradeActions;
  lit: number | undefined;
  written: string;
}) {
  const bubble = "max-w-full rounded-2xl rounded-tl-sm border bg-card px-4 py-3 lg:px-5";
  const who = (
    <h2 className={cn(LABEL, "flex items-center gap-1.5")}>
      <span className="flex size-5 items-center justify-center rounded-full bg-primary/12 text-primary">
        <Sparkles aria-hidden className="size-3" />
      </span>
      Grader
    </h2>
  );
  if (proto.status === "grading") {
    return (
      <section
        role="status"
        aria-label="The Grader is reading your answer"
        className="flex flex-col items-start gap-1.5 pr-8 sm:pr-16"
      >
        {who}
        <div className={cn(bubble, "flex items-center gap-1.5 py-4")}>
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              aria-hidden
              style={{ animationDelay: `${i * 160}ms` }}
              className="size-2 animate-bounce rounded-full bg-muted-foreground/60 motion-reduce:animate-none"
            />
          ))}
          <span className="ml-2 text-sm text-muted-foreground">Reading your answer</span>
        </div>
      </section>
    );
  }
  if (proto.status === "failed" && proto.failure) {
    return (
      <section
        role="alert"
        aria-label="The Grader couldn't grade it"
        className="flex flex-col items-start gap-1.5 pr-8 sm:pr-16"
      >
        {who}
        <div className={cn(bubble, "flex flex-col gap-3 border-destructive/30")}>
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
      </section>
    );
  }
  const result = proto.result;
  if (result === undefined) return null;
  return (
    <section
      aria-label="The Grader's reply"
      className="flex flex-col items-start gap-1.5 pr-8 sm:pr-16"
    >
      {who}
      <div className={cn(bubble, "flex flex-col gap-3")}>
        <CardText
          text={result.feedback}
          interactive
          className="text-[0.95rem] leading-relaxed [&_ol]:flex [&_ol]:flex-col [&_ol]:gap-2"
        />
        {result.mistakes.map((m) => (
          <figure
            key={m.n}
            id={`quote-${m.n}`}
            className={cn(
              "flex flex-col gap-1 rounded-lg border-l-[3px] border-destructive bg-muted/60 px-3 py-2 transition-colors",
              lit === m.n && "bg-destructive/10",
            )}
          >
            <blockquote className="flex gap-1.5 text-xs text-muted-foreground">
              <span className="font-bold text-destructive">{m.n}</span>
              <span className="shrink-0">You wrote</span>
              <CardLine text={quoteOf(written, m.from, m.to)} className="min-w-0 flex-1 italic" />
            </blockquote>
            <CardText text={m.note} className="text-sm leading-relaxed" />
          </figure>
        ))}
        <p className="flex items-center gap-1.5 border-t pt-3 text-sm text-muted-foreground">
          I'd rate it{" "}
          <span className="font-semibold text-primary">{RATING_LABELS[result.rating]}</span>
          <span className="hidden lg:inline">· Enter takes it</span>
        </p>
      </div>
    </section>
  );
}

/** The part of your message a mistake covers, widened to the whole Formula it touches. */
function quoteOf(written: string, from: number, to: number): string {
  let start = from;
  let end = to;
  const dollarsBefore = (written.slice(0, from).match(/(?<!\\)\$/g) ?? []).length;
  if (dollarsBefore % 2 === 1) {
    start = written.lastIndexOf("$", from - 1);
    const close = written.indexOf("$", to);
    end = close < 0 ? written.length : close + 1;
  }
  return written.slice(start, end);
}

/** The dock after Check: the four ratings, or, with one selected before the suggestion, the commit bar. */
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
  const picked = proto.status === "grading" ? proto.selected : undefined;
  if (picked !== undefined) {
    return (
      <div className="flex flex-col gap-2">
        <p className="flex min-h-5 items-center justify-center gap-1.5 text-xs font-medium text-muted-foreground">
          <LoaderCircle aria-hidden className="size-3.5 animate-spin motion-reduce:animate-none" />
          The Grader is still reading. Confirm now, or change your pick.
        </p>
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-2">
          <div className="flex h-[4.5rem] items-center gap-2 rounded-2xl border bg-card pr-1 pl-4 lg:h-16">
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-lg font-semibold tabular-nums">
                {intervals && formatInterval(intervals[picked], state.previewedAt)}
              </span>
              <span className="text-xs font-medium text-muted-foreground">
                {RATING_LABELS[picked]}
              </span>
            </span>
            <Button
              variant="ghost"
              aria-label={`Change from ${RATING_LABELS[picked]}`}
              onClick={grade.deselect}
              onMouseDown={(event) => event.preventDefault()}
              className="h-11 shrink-0 gap-1 rounded-full px-3 text-sm text-muted-foreground lg:h-9"
            >
              <X aria-hidden className="size-4" />
              Change
            </Button>
          </div>
          <Button
            className={cn(PILL, "h-[4.5rem] text-base lg:h-16")}
            disabled={!state.ratable}
            onClick={grade.confirm}
            onMouseDown={(event) => event.preventDefault()}
          >
            <Check aria-hidden className="size-5" />
            Confirm {RATING_LABELS[picked]}
            <kbd
              aria-hidden
              className="ml-1 hidden rounded border border-primary-foreground/30 px-1.5 font-sans text-[0.7rem] lg:inline"
            >
              Enter
            </kbd>
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="flex min-h-5 items-center justify-center gap-1.5 text-center text-xs font-medium text-muted-foreground">
        {proto.status === "grading"
          ? "Pick a rating to confirm it, or wait for the Grader's"
          : proto.status === "failed"
            ? "Rate it yourself"
            : "Tap a rating to save it"}
      </p>
      <div className="grid grid-cols-4 rounded-2xl border bg-card">
        {RATINGS.map((rating, i) => {
          const isSuggested = suggested === rating;
          return (
            <button
              key={rating}
              type="button"
              data-rating={rating}
              aria-pressed={proto.status === "grading" ? false : undefined}
              disabled={!state.ratable}
              onClick={() => grade.tap(rating)}
              aria-label={`${RATING_LABELS[rating]}${intervals ? `, ${formatInterval(intervals[rating], state.previewedAt)}` : ""}${isSuggested ? ", suggested" : ""}`}
              className={cn(
                "relative flex h-[4.5rem] flex-col items-center justify-center gap-0.5 outline-none transition-colors hover:bg-muted focus-visible:z-10 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 lg:h-16",
                i > 0 && "border-l",
                i === 0 && "rounded-l-2xl",
                i === 3 && "rounded-r-2xl",
                isSuggested && "bg-primary/8",
              )}
            >
              {isSuggested && (
                <span
                  aria-hidden
                  className="absolute top-1.5 left-2 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground"
                >
                  <Sparkles className="size-3" />
                </span>
              )}
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
                  isSuggested && "font-semibold text-primary",
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
      </div>
    </div>
  );
}
