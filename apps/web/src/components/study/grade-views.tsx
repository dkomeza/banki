import { RATINGS, type Rating } from "@banki/shared";
import { Link } from "@tanstack/react-router";
import { AlertCircle, Check, LoaderCircle, Sparkles } from "lucide-react";
import { ChevronDown } from "lucide-react";
import { type ReactNode, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
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

// PROTOTYPE (BAN-40), Variant h, "Margin, verdict first": d's Margin, with
// the Grader's verdict read first. A strip under the Front, its height held
// from Check, says what the Grader suggests and the Feedback's first
// paragraph; "Full feedback" opens the rest in place. The notes are d's
// margin from 1024 px; below it each mistake's number is a button that opens
// its note under the paragraph. In the dock, Confirm sits in the row above
// the ratings instead of floating over them.

export const REVEALED_WIDTH = "max-w-2xl lg:max-w-6xl";

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

/** The Feedback's first paragraph, and the rest. */
function splitFeedback(feedback: string) {
  const at = feedback.search(/\n[ \t]*\n/);
  return at < 0
    ? { lead: feedback, rest: "" }
    : { lead: feedback.slice(0, at), rest: feedback.slice(at).trim() };
}

const TAG =
  "mx-0.5 inline-flex h-[1.15rem] min-w-[1.15rem] -translate-y-px items-center justify-center rounded-[0.3rem] bg-destructive px-1 align-middle font-sans text-[0.65rem] font-semibold text-white";

/** A mistake's tag, after its last mark: its note's number, a button opening the note below 1024 px. */
function tagFor(open: ReadonlySet<number>, toggle: (n: number) => void) {
  return (h: Highlight) =>
    h.kind === "mistake" ? (
      <span key={`tag-${h.n}`} className="contents">
        <span aria-hidden className={cn(TAG, "hidden lg:inline-flex")}>
          {h.n}
        </span>
        <button
          type="button"
          aria-expanded={open.has(h.n)}
          aria-label={`Note ${h.n}`}
          onClick={(event) => {
            event.stopPropagation();
            toggle(h.n);
          }}
          className="relative mx-0.5 inline-flex -translate-y-px align-middle outline-none before:absolute before:-inset-3 before:content-[''] focus-visible:outline-2 focus-visible:outline-ring lg:hidden"
        >
          <span
            className={cn(
              TAG,
              "mx-0 h-6 min-w-6 rounded-md text-xs",
              open.has(h.n) && "ring-2 ring-destructive/40",
            )}
          >
            {h.n}
          </span>
        </button>
      </span>
    ) : null;
}

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
  const answer = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set());
  const toggle = useCallback(
    (n: number) =>
      setOpen((old) => {
        const next = new Set(old);
        if (next.has(n)) next.delete(n);
        else next.add(n);
        return next;
      }),
    [],
  );
  const tag = useMemo(() => tagFor(open, toggle), [open, toggle]);
  return (
    <>
      <div
        aria-hidden
        className="my-6 h-px w-16 bg-border [view-transition-name:card-rule] lg:my-8"
      />
      <Verdict key={state.shown?.card.id} proto={proto} grade={grade} />
      <div className="grid gap-x-12 gap-y-8 lg:grid-cols-[minmax(0,1fr)_19rem] xl:grid-cols-[minmax(0,1fr)_22rem]">
        <section aria-label="Your answer" className="flex min-w-0 flex-col gap-2">
          <div className="flex min-h-5 items-center justify-between gap-2">
            <h2 className={LABEL}>Your answer</h2>
            {result && result.mistakes.length > 0 && (
              <span className="text-xs font-medium text-destructive">
                {result.mistakes.length} {result.mistakes.length === 1 ? "mistake" : "mistakes"}
                <span className="lg:hidden"> · tap a number</span>
              </span>
            )}
          </div>
          <div
            ref={answer}
            className="flex flex-col gap-2 rounded-xl border border-dashed bg-muted/50 px-4 py-3 lg:px-5 lg:py-4"
          >
            {paragraphs(state.written ?? "", result?.mistakes ?? []).map((p, i) => (
              <div key={i} className="flex flex-col gap-2">
                <CardText
                  text={p.text}
                  interactive
                  highlights={p.mistakes}
                  after={tag}
                  className={cn("text-base leading-relaxed lg:text-lg", MISTAKE_MARKS)}
                />
                {/* Below 1024 px, an opened note under the paragraph of its mistake. */}
                {p.ending
                  .filter((m) => open.has(m.n))
                  .map((m) => (
                    <Note key={m.n} mistake={m} className="mb-1 lg:hidden" />
                  ))}
              </div>
            ))}
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
              "text-lg leading-relaxed [view-transition-name:card-back] lg:text-xl",
              MISSING_MARKS,
            )}
          />
        </section>
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

function Note({
  mistake,
  style,
  className,
}: {
  mistake: Mistake;
  style?: React.CSSProperties;
  className?: string;
}) {
  return (
    <div
      data-note={className === undefined ? "" : undefined}
      role="note"
      style={style}
      className={cn("flex gap-2.5 border-l-2 border-destructive py-0.5 pl-3", className)}
    >
      <span className="mt-0.5 inline-flex h-[1.15rem] min-w-[1.15rem] shrink-0 items-center justify-center rounded-[0.3rem] bg-destructive px-1 text-[0.65rem] font-semibold text-white">
        {mistake.n}
      </span>
      <CardText text={mistake.note} className="min-w-0 text-sm leading-relaxed" />
    </div>
  );
}

/**
 * The verdict, under the Front: the suggestion and the Feedback's first
 * paragraph, the rest behind "Full feedback". Its height is held from Check,
 * so the answer under it stays put when the result lands.
 */
function Verdict({ proto, grade }: { proto: GradeProto; grade: GradeActions }) {
  const [full, setFull] = useState(false);
  const shell = "mb-8 flex min-h-[7.5rem] flex-col gap-3 rounded-2xl border p-4 lg:mb-10 lg:p-5";
  if (proto.status === "failed" && proto.failure) {
    return (
      <section role="alert" aria-label="Grading" className={cn(shell, "border-destructive/30")}>
        <p className="flex items-start gap-2 text-base leading-relaxed text-destructive">
          <AlertCircle aria-hidden className="mt-1 size-4 shrink-0" />
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
      </section>
    );
  }
  if (proto.status === "grading") {
    return (
      <section
        role="status"
        aria-label="Grading your answer"
        className={cn(shell, "border-dashed")}
      >
        <p className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <LoaderCircle
            aria-hidden
            className="size-4 shrink-0 animate-spin motion-reduce:animate-none"
          />
          Grading your answer against the Back…
        </p>
        <span
          aria-hidden
          className="h-3 w-11/12 animate-pulse rounded-full bg-muted motion-reduce:animate-none"
        />
        <span
          aria-hidden
          className="h-3 w-3/5 animate-pulse rounded-full bg-muted motion-reduce:animate-none"
        />
      </section>
    );
  }
  const result = proto.result;
  if (result === undefined) return null;
  const { lead, rest } = splitFeedback(result.feedback);
  return (
    <section aria-label="Feedback" className={cn(shell, "bg-card")}>
      <p className="flex items-center gap-2 text-sm">
        <Sparkles aria-hidden className="size-4 shrink-0 text-primary" />
        <span className="text-muted-foreground">
          Suggests{" "}
          <span className="font-semibold text-primary">{RATING_LABELS[result.rating]}</span>
        </span>
      </p>
      <CardText text={lead} interactive className="text-base leading-relaxed lg:text-lg" />
      {rest !== "" && full && (
        <CardText
          text={rest}
          interactive
          className="text-base leading-relaxed lg:text-[1.05rem] [&_ol]:flex [&_ol]:flex-col [&_ol]:gap-2"
        />
      )}
      {rest !== "" && (
        <button
          type="button"
          aria-expanded={full}
          onClick={() => setFull((f) => !f)}
          className="-mx-2 inline-flex h-11 items-center gap-1 self-start rounded-full px-2 text-sm font-medium text-primary outline-none hover:underline focus-visible:outline-2 focus-visible:outline-ring lg:h-8"
        >
          {full ? "Less" : "Full feedback"}
          <ChevronDown
            aria-hidden
            className={cn(
              "size-4 transition-transform motion-reduce:transition-none",
              full && "rotate-180",
            )}
          />
        </button>
      )}
    </section>
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
      {confirming !== undefined ? (
        <ConfirmRow rating={confirming} state={state} grade={grade} />
      ) : (
        <p className="flex h-11 items-center justify-center gap-1.5 text-center text-xs font-medium text-muted-foreground lg:h-9">
          <Hint proto={proto} />
        </p>
      )}
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

/** Above the ratings, in the hint's place: Confirm the one selected, with Enter. */
function ConfirmRow({
  rating,
  state,
  grade,
}: {
  rating: Rating;
  state: StudyState;
  grade: GradeActions;
}) {
  return (
    <div className="flex h-11 items-center justify-center gap-3 lg:h-9">
      <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <LoaderCircle aria-hidden className="size-3.5 animate-spin motion-reduce:animate-none" />
        Still grading
      </span>
      <Button
        className={cn(PILL, "h-11 gap-1.5 px-5 whitespace-nowrap lg:h-9")}
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
    </div>
  );
}
