import { RATINGS } from "@banki/shared";
import { Link } from "@tanstack/react-router";
import { AlertCircle, Check, ChevronDown, LoaderCircle, Sparkles, X } from "lucide-react";
import { type MouseEvent, useLayoutEffect, useRef, useState } from "react";
import { CardText } from "@/components/cards/card-text";
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

// PROTOTYPE (BAN-40), Variant b, "Verdict": the Card stays the one reading
// column it is after Check (the Front, Your answer, the Back), and the
// Grader's verdict lives in the dock, with the ratings it is about: a panel
// of fixed height above them, from Check, that says it is grading, then
// holds the suggestion and the Feedback (More opens it all, upward, over the
// Card), or the failure. So nothing on the Card moves when the result lands.
// A mistake is underlined in red: a tap on it opens its note under it, the
// first one open to start with. The missing part is underlined in the
// accent. The suggestion wears a "Suggested" tab on its button; a selection
// before it is tinted in the accent, with Confirm in the panel.

export const REVEALED_WIDTH = "max-w-2xl";

const LABEL = "text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase";

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
      <Answer key={state.shown?.card.id} text={state.written ?? ""} proto={proto} />
      <div
        aria-hidden
        className="my-6 h-px w-16 bg-border [view-transition-name:card-rule] lg:my-8"
      />
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className={LABEL}>Answer</h2>
        {result && result.missing.length > 0 && (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <span aria-hidden className="h-0.5 w-4 rounded-full bg-primary" />
            Missing from yours
          </span>
        )}
      </div>
      <CardText
        text={back}
        interactive
        highlights={result?.missing}
        className="text-lg leading-relaxed [view-transition-name:card-back] lg:text-xl [&_mark[data-highlight=missing]]:bg-primary/8 [&_mark[data-highlight=missing]]:text-inherit [&_mark[data-highlight=missing]]:underline [&_mark[data-highlight=missing]]:decoration-primary [&_mark[data-highlight=missing]]:decoration-2 [&_mark[data-highlight=missing]]:underline-offset-[0.3em] [&_mark[data-highlight=missing]_.katex]:shadow-[inset_0_-2px_0_var(--primary)]"
      />
    </>
  );
}

/** The Written answer on its slip, its mistakes underlined; a tap on one opens its note under it. */
function Answer({ text, proto }: { text: string; proto: GradeProto }) {
  const result = proto.status === "graded" ? proto.result : undefined;
  const mistakes = result?.mistakes ?? [];
  const [open, setOpen] = useState<number | undefined>(1);
  const slip = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ top: number; caret: number } | undefined>();
  const note = mistakes.find((m) => m.n === open);
  useLayoutEffect(() => {
    const box = slip.current;
    if (box === null || note === undefined) {
      setAt(undefined);
      return () => {};
    }
    const place = () => {
      const marks = box.querySelectorAll<HTMLElement>(
        `mark[data-highlight=mistake][data-n="${note.n}"]`,
      );
      const last = marks[marks.length - 1];
      if (last === undefined) return;
      const b = box.getBoundingClientRect();
      const m = last.getBoundingClientRect();
      setAt({ top: m.bottom - b.top + 8, caret: m.left - b.left + Math.min(m.width / 2, 40) });
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(box);
    return () => observer.disconnect();
  }, [note]);
  const onClick = (event: MouseEvent) => {
    const mark =
      event.target instanceof Element ? event.target.closest("mark[data-highlight=mistake]") : null;
    if (mark === null) return;
    const n = Number(mark.getAttribute("data-n"));
    setOpen(open === n ? undefined : n);
  };
  return (
    <section aria-label="Your answer" className="mt-6 lg:mt-8">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className={LABEL}>Your answer</h2>
        {mistakes.length > 0 && (
          <span className="text-xs font-medium text-destructive">
            {mistakes.length} {mistakes.length === 1 ? "mistake" : "mistakes"} · tap to read
          </span>
        )}
      </div>
      {/* oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- PROTOTYPE: a tap on a mistake opens its note. */}
      <div
        ref={slip}
        onClick={onClick}
        className="relative rounded-xl border border-dashed bg-muted/50 px-4 py-3 lg:px-5 lg:py-4"
      >
        <CardText
          text={text}
          interactive
          highlights={mistakes}
          className={cn(
            "text-base leading-relaxed lg:text-lg",
            "[&_mark[data-highlight=mistake]]:cursor-pointer [&_mark[data-highlight=mistake]]:bg-transparent [&_mark[data-highlight=mistake]]:text-inherit [&_mark[data-highlight=mistake]]:underline [&_mark[data-highlight=mistake]]:decoration-destructive [&_mark[data-highlight=mistake]]:decoration-wavy [&_mark[data-highlight=mistake]]:decoration-from-font [&_mark[data-highlight=mistake]]:underline-offset-4 [&_mark[data-highlight=mistake]_.katex]:shadow-[inset_0_-2px_0_var(--destructive)] [&_mark[data-highlight=mistake]:hover]:bg-destructive/8",
            // The open note's mark, tinted (static classes, so Tailwind sees them).
            open === 1 && "[&_mark[data-n='1'][data-highlight=mistake]]:bg-destructive/12",
            open === 2 && "[&_mark[data-n='2'][data-highlight=mistake]]:bg-destructive/12",
            open === 3 && "[&_mark[data-n='3'][data-highlight=mistake]]:bg-destructive/12",
          )}
        />
        {note !== undefined && at !== undefined && (
          <div
            role="note"
            style={{ top: at.top }}
            className="absolute inset-x-2 z-[5] rounded-lg border border-destructive/30 bg-card px-3 py-2 text-sm shadow-lg sm:inset-x-3"
          >
            <span
              aria-hidden
              style={{ left: Math.max(8, at.caret - 6) }}
              className="absolute -top-1.5 size-3 rotate-45 border-t border-l border-destructive/30 bg-card"
            />
            <div className="flex items-start gap-2">
              <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
              <CardText text={note.note} className="min-w-0 flex-1 text-sm leading-relaxed" />
              <button
                type="button"
                aria-label="Close note"
                onClick={(event) => {
                  event.stopPropagation();
                  setOpen(undefined);
                }}
                className="-m-1 flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted lg:size-7"
              >
                <X aria-hidden className="size-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

/** The dock after Check: the verdict panel, then the four ratings. */
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
    <div className="flex flex-col gap-3">
      <Verdict key={state.shown?.card.id} state={state} proto={proto} grade={grade} />
      <div className="grid grid-cols-4 rounded-2xl border bg-card">
        {RATINGS.map((rating, i) => {
          const selected = proto.selected === rating;
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
                i === 0 && "rounded-l-2xl",
                i === 3 && "rounded-r-2xl",
                selected &&
                  "bg-primary/12 shadow-[inset_0_0_0_2px_var(--primary)] hover:bg-primary/15",
              )}
            >
              {suggested === rating && (
                <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 rounded-full bg-primary px-2 py-px text-[0.65rem] leading-4 font-semibold whitespace-nowrap text-primary-foreground">
                  Suggested
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
                  (selected || suggested === rating) && "text-primary",
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

/** The panel above the ratings, one height from Check until More opens it. */
function Verdict({
  state,
  proto,
  grade,
}: {
  state: StudyState;
  proto: GradeProto;
  grade: GradeActions;
}) {
  const [more, setMore] = useState(false);
  const head = "flex min-h-11 items-center gap-2 lg:min-h-9";
  const box = cn(
    "flex flex-col gap-1 rounded-2xl border bg-card px-4 py-2",
    more ? "max-h-[55svh] overflow-y-auto" : "h-[8.25rem] overflow-hidden lg:h-[7.5rem]",
  );
  if (proto.status === "failed" && proto.failure) {
    return (
      <div role="alert" className={cn(box, "border-destructive/30")}>
        <div className={cn(head, "text-sm text-destructive")}>
          <AlertCircle aria-hidden className="size-4 shrink-0" />
          <span className="min-w-0 flex-1 font-medium">
            {proto.failure === "no_api_key" ? "No API key" : "Not graded"}
          </span>
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
        <p className="text-sm leading-relaxed text-destructive">
          {FAILURE_MESSAGES[proto.failure]}
        </p>
        <p className="text-sm text-muted-foreground">
          Compare it with the Back and rate it yourself.
        </p>
      </div>
    );
  }
  if (proto.status === "grading") {
    return (
      <div role="status" aria-label="Grading your answer" className={box}>
        <div className={cn(head, "text-sm text-muted-foreground")}>
          <LoaderCircle
            aria-hidden
            className="size-4 shrink-0 animate-spin motion-reduce:animate-none"
          />
          <span className="min-w-0 flex-1 truncate">
            {proto.selected === undefined ? (
              "Grading your answer…"
            ) : (
              <>
                <span className="font-medium text-foreground">{RATING_LABELS[proto.selected]}</span>{" "}
                selected, still grading
              </>
            )}
          </span>
          {proto.selected !== undefined && (
            <Button
              className={cn(PILL, "h-11 shrink-0 gap-1.5 lg:h-8 lg:px-4")}
              disabled={!state.ratable}
              onClick={grade.confirm}
              onMouseDown={(event) => event.preventDefault()}
            >
              <Check aria-hidden className="size-4" />
              Confirm {RATING_LABELS[proto.selected]}
              <kbd
                aria-hidden
                className="ml-0.5 hidden rounded border border-primary-foreground/30 px-1 font-sans text-[0.65rem] lg:inline"
              >
                Enter
              </kbd>
            </Button>
          )}
        </div>
        <span
          aria-hidden
          className="mt-1 h-2.5 w-11/12 animate-pulse rounded-full bg-muted motion-reduce:animate-none"
        />
        <span
          aria-hidden
          className="mt-2 h-2.5 w-3/4 animate-pulse rounded-full bg-muted motion-reduce:animate-none"
        />
        {proto.selected === undefined && (
          <p className="mt-auto pb-1 text-xs text-muted-foreground">
            Or pick a rating now, and confirm it.
          </p>
        )}
      </div>
    );
  }
  const result = proto.result;
  if (result === undefined) return null;
  return (
    <section aria-label="The Grader's verdict" className={cn(box, "relative")}>
      <div className={cn(head, "text-sm")}>
        <Sparkles aria-hidden className="size-4 shrink-0 text-primary" />
        <span className="min-w-0 flex-1 truncate text-muted-foreground">
          Suggests{" "}
          <span className="font-semibold text-primary">{RATING_LABELS[result.rating]}</span>
          {proto.selected !== undefined && (
            <>
              {" "}
              · you picked{" "}
              <span className="font-medium text-foreground">{RATING_LABELS[proto.selected]}</span>
            </>
          )}
          <span className="hidden lg:inline"> · Enter to take it</span>
        </span>
        <button
          type="button"
          aria-expanded={more}
          onClick={() => setMore(!more)}
          onMouseDown={(event) => event.preventDefault()}
          className="-mr-2 flex h-11 shrink-0 items-center gap-1 rounded-full px-3 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground lg:h-8"
        >
          {more ? "Less" : "More"}
          <ChevronDown
            aria-hidden
            className={cn("size-4 transition-transform", more && "rotate-180")}
          />
        </button>
      </div>
      <CardText
        text={result.feedback}
        interactive
        className={cn(
          "text-sm leading-relaxed [&_ol]:flex [&_ol]:flex-col [&_ol]:gap-1.5",
          !more && "[mask-image:linear-gradient(to_bottom,#000_60%,transparent)]",
        )}
      />
    </section>
  );
}
