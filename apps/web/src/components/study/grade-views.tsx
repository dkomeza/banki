import { RATINGS, type Rating } from "@banki/shared";
import { Link } from "@tanstack/react-router";
import { AlertCircle, Check, ChevronDown, LoaderCircle, Sparkles } from "lucide-react";
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
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
import { MISTAKE_MARKS, markRects, useMistakeMarks } from "@/components/study/mistake-marks";
import { RATING_KEYS, RATING_LABELS, type StudyState, formatInterval } from "@/lib/study";
import { cn } from "@/lib/utils";

// PROTOTYPE (BAN-40), Variant j, "Margin, notes at the mark": d's Margin,
// with the Grader's notes moved onto the mistakes themselves. A mistake is
// marked as in d, with no number; hovering it (or tapping it, on a phone)
// opens its note in a bubble just under it, so the note is read where the
// mistake is. That frees d's margin for the Feedback alone: from 1024 px it
// runs beside your answer and the Back, held in view (sticky) while a long
// Back, with its pictures, scrolls past. Below 1024 px the Feedback comes
// after your answer, before the Back, and once it scrolls away a slim tab
// under the header keeps the suggestion in view and drops the Feedback down
// over the Back. The dock is d's.

export const REVEALED_WIDTH = "max-w-2xl lg:max-w-6xl";

const LABEL = "text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase";

type Mistake = GradeResult["mistakes"][number];

const MISSING_MARKS =
  "[&_mark[data-highlight=missing]]:bg-primary/15 [&_mark[data-highlight=missing]]:text-inherit [&_mark[data-highlight=missing]]:[box-decoration-break:clone] [&_mark[data-highlight=missing]]:rounded-[0.2em] [&_mark[data-highlight=missing]]:underline [&_mark[data-highlight=missing]]:decoration-primary [&_mark[data-highlight=missing]]:decoration-dashed [&_mark[data-highlight=missing]]:underline-offset-[0.3em]";

/** Where the header ends, for what sticks under it. */
const UNDER_HEADER = "top-[calc(3.5rem+env(safe-area-inset-top))]";

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
  const feedback = useRef<HTMLElement>(null);
  return (
    <>
      <div
        aria-hidden
        className="my-6 h-px w-16 bg-border [view-transition-name:card-rule] lg:my-8"
      />
      <div className="grid gap-x-12 gap-y-8 lg:grid-cols-[minmax(0,1fr)_19rem] xl:grid-cols-[minmax(0,1fr)_22rem]">
        <YourAnswer key={state.shown?.card.id} written={state.written ?? ""} result={result} />
        {/* The margin: the Feedback alone, beside your answer and the Back, held in view. */}
        <aside
          ref={feedback}
          aria-label="Feedback"
          className="min-w-0 lg:col-start-2 lg:row-span-2 lg:row-start-1"
        >
          <div
            className={cn(
              "flex flex-col gap-2 lg:sticky lg:max-h-[calc(100dvh-14rem)] lg:overflow-y-auto lg:pb-2",
              "lg:top-[calc(4.5rem+env(safe-area-inset-top))]",
            )}
          >
            <div className="flex min-h-5 items-center gap-2">
              <h2 className={LABEL}>Feedback</h2>
            </div>
            <Feedback proto={proto} grade={grade} />
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
      <FeedbackTab target={feedback} proto={proto} grade={grade} />
    </>
  );
}

/** Your answer, its mistakes marked; each opens its note in a bubble under it. */
function YourAnswer({ written, result }: { written: string; result: GradeResult | undefined }) {
  const box = useRef<HTMLDivElement>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const mistakes = result?.mistakes;
  const { shown, noteProps } = useMistakeMarks(box, bubble);
  const mistake = mistakes?.find((m) => m.n === shown?.n);
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
              <span className="pointer-fine:hidden"> · tap one to see why</span>
              <span className="hidden pointer-fine:inline"> · point at one to see why</span>
            </span>
          </span>
        )}
      </div>
      <div
        ref={box}
        className="relative rounded-xl border border-dashed bg-muted/50 px-4 py-3 lg:px-5 lg:py-4"
      >
        <CardText
          text={written}
          highlights={mistakes}
          className={cn("text-base leading-relaxed lg:text-lg", MISTAKE_MARKS)}
        />
        {mistake && <Bubble ref={bubble} box={box} mistake={mistake} {...noteProps} />}
      </div>
    </section>
  );
}

/** A mistake's note, in a bubble just under its last line, its point at the mark. */
function Bubble({
  ref,
  box,
  mistake,
  ...pointer
}: {
  ref: React.RefObject<HTMLDivElement | null>;
  box: React.RefObject<HTMLDivElement | null>;
  mistake: Mistake;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
}) {
  const [at, setAt] = useState<{ top: number; left: number; point: number } | undefined>();
  useLayoutEffect(() => {
    const root = box.current;
    const self = ref.current;
    if (root === null || self === null) return () => {};
    const place = () => {
      const rects = markRects(root, mistake.n);
      if (rects === undefined) return;
      const width = self.offsetWidth;
      const room = root.clientWidth;
      const anchor = Math.min(rects.last.right, rects.last.left + 40);
      const left = Math.max(8, Math.min(room - width - 8, anchor - 28));
      setAt({
        top: rects.last.bottom + 10,
        left,
        point: Math.max(16, Math.min(width - 16, anchor - left)),
      });
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(root);
    return () => observer.disconnect();
  }, [box, ref, mistake]);
  return (
    <div
      ref={ref}
      role="note"
      aria-live="polite"
      style={at ? { top: at.top, left: at.left } : { visibility: "hidden", top: 0, left: 0 }}
      className="absolute z-20 w-[min(21rem,calc(100%-1rem))] animate-in rounded-xl border border-destructive/30 bg-card px-3.5 py-3 shadow-lg duration-150 fade-in-0 zoom-in-95 motion-reduce:animate-none"
      {...pointer}
    >
      <span
        aria-hidden
        style={{ left: at?.point ?? 16 }}
        className="absolute -top-[0.35rem] size-2.5 -translate-x-1/2 rotate-45 border-t border-l border-destructive/30 bg-card"
      />
      <p className="mb-1 text-[0.7rem] font-semibold tracking-[0.08em] text-destructive uppercase">
        Why it's wrong
      </p>
      <CardText text={mistake.note} className="text-sm leading-relaxed" />
    </div>
  );
}

/**
 * Below 1024 px, once the Feedback has scrolled away: a tab under the header
 * with the suggestion, which drops the Feedback down over the Back.
 */
function FeedbackTab({
  target,
  proto,
  grade,
}: {
  target: React.RefObject<HTMLElement | null>;
  proto: GradeProto;
  grade: GradeActions;
}) {
  const [past, setPast] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const el = target.current;
    if (el === null) return () => {};
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry === undefined) return;
        const now = !entry.isIntersecting && entry.boundingClientRect.top < 120;
        setPast(now);
        // Back in view, the tab goes, and opens shut next time.
        if (!now) setOpen(false);
      },
      { rootMargin: "-56px 0px 0px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [target]);
  if (!past) return null;
  const result = proto.status === "graded" ? proto.result : undefined;
  return (
    <div className={cn("fixed inset-x-0 z-[9] lg:hidden", UNDER_HEADER)}>
      <div className="mx-auto max-w-2xl px-4 sm:px-8">
        <div className="overflow-hidden rounded-b-2xl border border-t-0 bg-background/95 shadow-md backdrop-blur">
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            className="flex h-11 w-full items-center gap-2 px-4 text-left text-sm"
          >
            {proto.status === "grading" ? (
              <>
                <LoaderCircle
                  aria-hidden
                  className="size-4 animate-spin text-muted-foreground motion-reduce:animate-none"
                />
                <span className="text-muted-foreground">Grading your answer…</span>
              </>
            ) : result ? (
              <>
                <Sparkles aria-hidden className="size-4 shrink-0 text-primary" />
                <span className="text-muted-foreground">
                  Suggests{" "}
                  <span className="font-semibold text-primary">{RATING_LABELS[result.rating]}</span>
                </span>
              </>
            ) : (
              <>
                <AlertCircle aria-hidden className="size-4 shrink-0 text-destructive" />
                <span className="text-muted-foreground">Not graded</span>
              </>
            )}
            <span className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
              {open ? "Hide" : "Feedback"}
              <ChevronDown
                aria-hidden
                className={cn("size-4 transition-transform", open && "rotate-180")}
              />
            </span>
          </button>
          {open && (
            <div className="max-h-[55dvh] overflow-y-auto border-t px-1 pt-1 pb-1">
              <Feedback proto={proto} grade={grade} bare />
            </div>
          )}
        </div>
      </div>
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
