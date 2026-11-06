import { RATINGS } from "@banki/shared";
import { Link } from "@tanstack/react-router";
import { AlertCircle, Check, LoaderCircle, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
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

// PROTOTYPE (BAN-40), Variant i, "Facing pages": d's marks and notes, with
// your answer and the Back facing each other. From 1024 px they are two equal
// columns, so the comparison reads across; below it they stack. Each note sits
// under the paragraph of its mistake at every size, so there is no margin to
// keep in line. The Feedback comes after both, full width, its place held
// from Check, so landing only lengthens the page. In the dock a selection
// before the suggestion turns its own cell into Confirm: tap it again.

export const REVEALED_WIDTH = "max-w-2xl lg:max-w-7xl";

const LABEL = "text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase";

type Mistake = GradeResult["mistakes"][number];

/** The Written answer's paragraphs, each with its own mistakes, shifted to start from it. */
function paragraphs(text: string, mistakes: readonly Mistake[]) {
  const out: { text: string; mistakes: Mistake[]; ending: Mistake[] }[] = [];
  const gap = /\n[ \t]*\n/g;
  let start = 0;
  for (;;) {
    const match = gap.exec(text);
    const end = match === null ? text.length : match.index;
    const inside = mistakes.filter((m) => m.from < end && m.to > start);
    if (text.slice(start, end).trim() !== "") {
      out.push({
        text: text.slice(start, end),
        mistakes: inside.map((m) => ({
          ...m,
          from: Math.max(0, m.from - start),
          to: Math.min(end - start, m.to - start),
        })),
        ending: mistakes.filter((m) => m.to > start && m.to <= end),
      });
    }
    if (match === null) return out;
    start = match.index + match[0].length;
  }
}

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
  "[&_mark[data-highlight=missing]]:bg-primary/12 [&_mark[data-highlight=missing]]:text-inherit [&_mark[data-highlight=missing]]:shadow-[inset_0_-2px_0_var(--primary)] [&_mark[data-highlight=missing]]:[box-decoration-break:clone]";

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
      <div className="grid gap-x-10 gap-y-8 lg:grid-cols-2 xl:gap-x-14">
        <section aria-label="Your answer" className="flex min-w-0 flex-col gap-2">
          <div className="flex min-h-5 items-center justify-between gap-2">
            <h2 className={LABEL}>Your answer</h2>
            {result && result.mistakes.length > 0 && (
              <span className="text-xs font-medium text-destructive">
                {result.mistakes.length} {result.mistakes.length === 1 ? "mistake" : "mistakes"}
              </span>
            )}
          </div>
          <div className="flex flex-col gap-2 rounded-xl border border-dashed bg-muted/50 px-4 py-3 lg:px-5 lg:py-4">
            {paragraphs(state.written ?? "", result?.mistakes ?? []).map((p, i) => (
              <div key={i} className="flex flex-col gap-2">
                <CardText
                  text={p.text}
                  interactive
                  highlights={p.mistakes}
                  after={tag}
                  className={cn("text-base leading-relaxed lg:text-lg", MISTAKE_MARKS)}
                />
                {/* Each note under the paragraph of its mistake. */}
                {p.ending.map((m) => (
                  <Note key={m.n} mistake={m} />
                ))}
              </div>
            ))}
          </div>
        </section>
        <section aria-label="Answer" className="flex min-w-0 flex-col gap-2">
          <div className="flex min-h-5 items-center justify-between gap-2">
            <h2 className={LABEL}>Answer</h2>
            {result && result.missing.length > 0 && (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <span aria-hidden className="h-3 w-4 border-b-2 border-primary bg-primary/12" />
                Missing from yours
              </span>
            )}
          </div>
          <CardText
            text={back}
            interactive
            highlights={result?.missing}
            className={cn(
              "text-lg leading-relaxed [view-transition-name:card-back]",
              MISSING_MARKS,
            )}
          />
        </section>
      </div>
      <aside aria-label="Feedback" className="mt-10 flex min-w-0 flex-col gap-2 lg:mt-12">
        <div className="flex min-h-5 items-center gap-2">
          <h2 className={LABEL}>Feedback</h2>
        </div>
        <Feedback proto={proto} grade={grade} />
      </aside>
    </>
  );
}

function Note({ mistake }: { mistake: Mistake }) {
  return (
    <div role="note" className="mb-1 flex gap-2.5 border-l-2 border-destructive py-0.5 pl-3">
      <span className="mt-0.5 inline-flex h-[1.15rem] min-w-[1.15rem] shrink-0 items-center justify-center rounded-[0.3rem] bg-destructive px-1 text-[0.65rem] font-semibold text-white">
        {mistake.n}
      </span>
      <CardText text={mistake.note} className="min-w-0 text-sm leading-relaxed" />
    </div>
  );
}

/** The Feedback, its place held while the Grader works, or the failure. */
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
    <div className="flex flex-col gap-4 rounded-xl border bg-card p-4 lg:p-6">
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
        className="max-w-3xl text-base leading-relaxed [&_ol]:flex [&_ol]:flex-col [&_ol]:gap-2"
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
      <p className="flex min-h-5 items-center justify-center gap-1.5 text-center text-xs font-medium text-muted-foreground">
        <Hint proto={proto} />
      </p>
      <div className="relative grid grid-cols-4 rounded-2xl border bg-card">
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
              onClick={() => (confirming === rating ? grade.confirm() : grade.tap(rating))}
              aria-label={`${confirming === rating ? "Confirm " : ""}${RATING_LABELS[rating]}${intervals ? `, ${formatInterval(intervals[rating], state.previewedAt)}` : ""}${isSuggested ? ", suggested" : ""}`}
              className={cn(
                "relative flex h-[4.5rem] flex-col items-center justify-center gap-0.5 outline-none transition-colors hover:bg-muted focus-visible:z-10 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 lg:h-16",
                i > 0 && "border-l",
                i === 0 && "rounded-l-2xl",
                i === 3 && "rounded-r-2xl",
                isSuggested && "bg-primary text-primary-foreground hover:bg-primary/90",
                confirming === rating && "bg-primary text-primary-foreground hover:bg-primary/90",
                selected &&
                  confirming === undefined &&
                  "shadow-[inset_0_0_0_2px_var(--foreground)]",
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
                  "inline-flex items-center gap-1 text-xs font-medium whitespace-nowrap text-muted-foreground",
                  rating === "again" && "text-destructive",
                  isSuggested && "text-primary-foreground",
                  confirming === rating && "text-primary-foreground",
                  selected && confirming === undefined && !isSuggested && "text-foreground",
                )}
              >
                {isSuggested && <Sparkles aria-hidden className="size-3" />}
                {confirming === rating ? (
                  <>
                    <Check aria-hidden className="size-3.5" />
                    Confirm
                    <span className="hidden sm:inline">{RATING_LABELS[rating]}</span>
                  </>
                ) : (
                  RATING_LABELS[rating]
                )}
              </span>
              <kbd
                aria-hidden
                className={cn(
                  "absolute top-1.5 right-2 hidden font-sans text-[0.65rem] text-muted-foreground lg:block",
                  (isSuggested || confirming === rating) && "text-primary-foreground/80",
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
        <LoaderCircle aria-hidden className="size-3.5 animate-spin motion-reduce:animate-none" />
        Still grading · tap {RATING_LABELS[proto.selected]} again to confirm it
        <span className="hidden lg:inline">, or press Enter</span>
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
