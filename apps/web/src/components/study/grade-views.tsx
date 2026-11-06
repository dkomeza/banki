import { RATINGS, type Rating } from "@banki/shared";
import { Link } from "@tanstack/react-router";
import { AlertCircle, Check, LoaderCircle, Sparkles } from "lucide-react";
import { CardText, type Highlight } from "@/components/cards/card-text";
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

// PROTOTYPE (BAN-40), Variant a, "Spread": after Check the Card spreads into
// columns, read left to right: Your answer, the Back, then the Grader's
// Feedback. Three from 1024 px, two on a tablet (the Feedback across under
// them), one on a phone. The Feedback's column is there from Check, its lines
// sketched while the Grader works, so nothing moves when it lands. A mistake
// carries a footnote number, its note listed under the answer; a missing
// part is shaded in the Back. The dock keeps one status line above the
// ratings, the same height in every state: grading, a selection to confirm,
// the suggestion, a failure.

/** From 1024 px the three columns need more than the Card's reading width. */
export const REVEALED_WIDTH = "max-w-2xl lg:max-w-7xl";

const LABEL = "text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase";

/** A mistake's footnote number, after its last mark. */
const footnote = (h: Highlight) =>
  h.kind === "mistake" ? (
    <sup
      key={`fn-${h.n}`}
      aria-label={`note ${h.n}`}
      className="ml-0.5 inline-flex size-[1.1rem] -translate-y-0.5 items-center justify-center rounded-full bg-destructive font-sans text-[0.65rem] font-semibold text-white not-italic"
    >
      {h.n}
    </sup>
  ) : null;

function Column({
  label,
  aside,
  className,
  children,
}: {
  label: string;
  aside?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={label} className={cn("flex min-w-0 flex-col gap-2", className)}>
      <div className="flex min-h-5 items-center justify-between gap-2">
        <h2 className={LABEL}>{label}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

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
      <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3 lg:gap-10">
        <Column
          label="Your answer"
          aside={
            result && result.mistakes.length > 0 ? (
              <span className="text-xs font-medium text-destructive">
                {result.mistakes.length} {result.mistakes.length === 1 ? "mistake" : "mistakes"}
              </span>
            ) : undefined
          }
        >
          <div className="rounded-xl border border-dashed bg-muted/50 px-4 py-3 lg:px-5 lg:py-4">
            <CardText
              text={state.written ?? ""}
              interactive
              highlights={result?.mistakes}
              after={footnote}
              className="text-base leading-relaxed lg:text-lg [&_mark[data-highlight=mistake]]:rounded-[0.2em] [&_mark[data-highlight=mistake]]:bg-transparent [&_mark[data-highlight=mistake]]:text-inherit [&_mark[data-highlight=mistake]]:underline [&_mark[data-highlight=mistake]]:decoration-destructive [&_mark[data-highlight=mistake]]:decoration-wavy [&_mark[data-highlight=mistake]]:decoration-from-font [&_mark[data-highlight=mistake]]:underline-offset-4 [&_mark[data-highlight=mistake]_.katex]:rounded-sm [&_mark[data-highlight=mistake]_.katex]:shadow-[inset_0_-2px_0_var(--destructive)]"
            />
          </div>
          {result && result.mistakes.length > 0 && (
            <ol className="flex flex-col gap-2 text-sm leading-relaxed">
              {result.mistakes.map((m) => (
                <li key={m.n} className="flex gap-2">
                  <span className="mt-0.5 inline-flex size-[1.1rem] shrink-0 items-center justify-center rounded-full bg-destructive text-[0.65rem] font-semibold text-white">
                    {m.n}
                  </span>
                  <CardText text={m.note} className="text-sm text-foreground" />
                </li>
              ))}
            </ol>
          )}
        </Column>
        <Column
          label="Answer"
          aside={
            result && result.missing.length > 0 ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <span aria-hidden className="h-3 w-4 rounded-[0.2em] bg-primary/20" />
                Missing from yours
              </span>
            ) : undefined
          }
        >
          <CardText
            text={back}
            interactive
            highlights={result?.missing}
            className="text-lg leading-relaxed [view-transition-name:card-back] lg:text-xl [&_mark[data-highlight=missing]]:bg-primary/20 [&_mark[data-highlight=missing]]:text-inherit [&_mark[data-highlight=missing]]:[box-decoration-break:clone]"
          />
        </Column>
        <Column label="Feedback" className="sm:col-span-2 lg:col-span-1">
          <Feedback proto={proto} />
        </Column>
      </div>
    </>
  );
}

/** The Feedback, or its lines sketched while the Grader works, or the failure. */
function Feedback({ proto }: { proto: GradeProto }) {
  if (proto.status === "graded" && proto.result) {
    return (
      <div className="rounded-xl border bg-card px-4 py-3 lg:px-5 lg:py-4">
        <CardText
          text={proto.result.feedback}
          interactive
          className="text-base leading-relaxed [&_ol]:flex [&_ol]:flex-col [&_ol]:gap-2"
        />
      </div>
    );
  }
  if (proto.status === "failed") {
    return (
      <div className="flex min-h-32 items-center rounded-xl border border-dashed px-4 py-3 text-sm text-muted-foreground lg:px-5">
        No Feedback for this answer. Compare it with the Back and rate it yourself.
      </div>
    );
  }
  return (
    <div
      role="status"
      aria-label="Grading your answer"
      className="flex min-h-32 flex-col gap-3 rounded-xl border bg-card px-4 py-4 lg:px-5"
    >
      {["w-11/12", "w-full", "w-4/5", "w-2/3"].map((w) => (
        <span
          key={w}
          aria-hidden
          className={cn("h-3 animate-pulse rounded-full bg-muted motion-reduce:animate-none", w)}
        />
      ))}
    </div>
  );
}

/** The dock after Check: one status line, then the four ratings. */
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
      <StatusLine state={state} proto={proto} grade={grade} />
      <div className="grid grid-cols-4 overflow-hidden rounded-2xl border bg-card">
        {RATINGS.map((rating, i) => {
          const selected = proto.selected === rating;
          const isSuggested = suggested === rating && proto.selected === undefined;
          return (
            <button
              key={rating}
              type="button"
              data-rating={rating}
              aria-pressed={proto.status === "grading" ? selected : undefined}
              disabled={!state.ratable}
              onClick={() => grade.tap(rating)}
              aria-label={`${RATING_LABELS[rating]}${intervals ? `, ${formatInterval(intervals[rating], state.previewedAt)}` : ""}${suggested === rating ? ", suggested" : ""}`}
              className={cn(
                "relative flex h-[4.5rem] flex-col items-center justify-center gap-0.5 outline-none transition-colors hover:bg-muted focus-visible:z-10 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 lg:h-16",
                i > 0 && "border-l",
                selected && "bg-foreground text-background hover:bg-foreground/90",
                suggested === rating && !selected && "bg-primary/10 hover:bg-primary/15",
              )}
            >
              {suggested === rating && (
                <span aria-hidden className="absolute inset-x-0 top-0 h-1 bg-primary" />
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
                  "text-xs font-medium",
                  selected
                    ? "text-background/80"
                    : isSuggested || suggested === rating
                      ? "text-primary"
                      : "text-muted-foreground",
                  rating === "again" && !selected && suggested !== rating && "text-destructive",
                )}
              >
                {RATING_LABELS[rating]}
              </span>
              <kbd
                aria-hidden
                className={cn(
                  "absolute top-1.5 right-2 hidden font-sans text-[0.65rem] lg:block",
                  selected ? "text-background/70" : "text-muted-foreground",
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

/** The line above the ratings: the same height whatever it says. */
function StatusLine({
  state,
  proto,
  grade,
}: {
  state: StudyState;
  proto: GradeProto;
  grade: GradeActions;
}) {
  const row = "flex h-11 items-center gap-2 px-1 text-sm lg:h-9";
  if (proto.status === "failed" && proto.failure) {
    return (
      <div role="alert" className={cn(row, "text-destructive")}>
        <AlertCircle aria-hidden className="size-4 shrink-0" />
        <span className="min-w-0 flex-1 leading-tight">{FAILURE_MESSAGES[proto.failure]}</span>
        {proto.failure === "no_api_key" ? (
          <Button
            variant="outline"
            className={cn(
              PILL,
              "h-11 shrink-0 border-destructive/40 text-destructive no-underline lg:h-8 lg:px-3",
            )}
            render={<Link to="/settings" />}
            nativeButton={false}
          >
            Settings
          </Button>
        ) : (
          <Button
            variant="outline"
            className={cn(
              PILL,
              "h-11 shrink-0 border-destructive/40 text-destructive lg:h-8 lg:px-3",
            )}
            onClick={grade.retry}
          >
            Try again
          </Button>
        )}
      </div>
    );
  }
  if (proto.status === "grading") {
    const selected: Rating | undefined = proto.selected;
    return (
      <div role="status" className={cn(row, "text-muted-foreground")}>
        <LoaderCircle
          aria-hidden
          className="size-4 shrink-0 animate-spin motion-reduce:animate-none"
        />
        <span className="min-w-0 flex-1 truncate">
          {selected === undefined ? (
            <>
              Grading…<span className="hidden sm:inline"> or pick a rating yourself</span>
            </>
          ) : (
            <>
              <span className="font-medium text-foreground">{RATING_LABELS[selected]}</span>{" "}
              selected
            </>
          )}
        </span>
        {selected !== undefined && (
          <Button
            className={cn(PILL, "h-11 shrink-0 gap-1.5 lg:h-8 lg:px-4")}
            disabled={!state.ratable}
            onClick={grade.confirm}
            onMouseDown={(event) => event.preventDefault()}
          >
            <Check aria-hidden className="size-4" />
            Confirm
            <kbd
              aria-hidden
              className="ml-0.5 hidden rounded border border-primary-foreground/30 px-1 font-sans text-[0.65rem] lg:inline"
            >
              Enter
            </kbd>
          </Button>
        )}
      </div>
    );
  }
  const suggested = proto.result?.rating;
  return (
    <div className={cn(row, "text-muted-foreground")}>
      <Sparkles aria-hidden className="size-4 shrink-0 text-primary" />
      <span className="min-w-0 flex-1 truncate">
        {suggested && proto.selected !== undefined ? (
          <>
            <span className="font-medium text-foreground">{RATING_LABELS[proto.selected]}</span>{" "}
            selected · the Grader suggests{" "}
            <span className="font-medium text-primary">{RATING_LABELS[suggested]}</span>
          </>
        ) : suggested ? (
          <>
            The Grader suggests{" "}
            <span className="font-medium text-primary">{RATING_LABELS[suggested]}</span>
            <span className="hidden lg:inline"> · Enter to take it</span>
          </>
        ) : (
          "Rate it yourself"
        )}
      </span>
    </div>
  );
}
