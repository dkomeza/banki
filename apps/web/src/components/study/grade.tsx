import { type GradeResponse, MODELS, RATINGS, type Rating } from "@banki/shared";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AlertCircle, Check, ChevronDown, LoaderCircle, Sparkles } from "lucide-react";
import {
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { CardText, type Highlight } from "@/components/cards/card-text";
import { PILL } from "@/components/settings/parts";
import { LABEL } from "@/components/study/answer";
import { MarginChat } from "@/components/study/chat-margin";
import { useChat } from "@/components/study/chat-proto";
import { lastLineOf, useMistakeNotes } from "@/components/study/mistake-notes";
import { Button } from "@/components/ui/button";
import { settingsQueryOptions } from "@/lib/settings";
import {
  GRADE_FAILURE_ACTIONS,
  type Grade,
  type GradeFailure,
  gradeFailureMessage,
  RATING_KEYS,
  RATING_LABELS,
  type StudySession,
  type StudyState,
  formatInterval,
} from "@/lib/study";
import { cn } from "@/lib/utils";

// The Grader's result on the study screen ("Margin, notes at the mark"):
// after Check, your answer, the Back and, in a margin beside them from 1024
// px, the Feedback, which stays in view (sticky) while a long Back scrolls
// past. Below 1024 px the Feedback comes between your answer and the Back,
// and once it has scrolled away a tab under the top bar keeps the suggestion
// in view and drops the Feedback down. While the Grader works, the Feedback's
// place is held, so nothing moves when it lands. A mistake in your answer is
// marked, and its note opens in a bubble just under it (mistake-notes.ts);
// what your answer misses is marked in the Back. In the dock the suggestion is
// filled in on its rating, and a Rating selected before it comes has Confirm.

/** The revealed Card's column after Check: wider from 1024 px, for the margin. */
export const GRADED_WIDTH = "max-w-2xl lg:max-w-6xl";

/** Where the top bar ends, for what sticks under it. */
const UNDER_TOP_BAR = "top-[calc(3.5rem+env(safe-area-inset-top))]";

const MISSING_MARKS =
  "[&_mark[data-highlight=missing]]:rounded-[0.2em] [&_mark[data-highlight=missing]]:bg-primary/15 [&_mark[data-highlight=missing]]:text-inherit [&_mark[data-highlight=missing]]:underline [&_mark[data-highlight=missing]]:decoration-primary [&_mark[data-highlight=missing]]:decoration-dashed [&_mark[data-highlight=missing]]:underline-offset-[0.3em] [&_mark[data-highlight=missing]]:[box-decoration-break:clone]";

// Below 1024 px a mistake is tapped: its hit area reaches 44 px tall, past its line.
const MISTAKE_MARKS =
  "max-lg:[&_mark[data-highlight=mistake]]:relative max-lg:[&_mark[data-highlight=mistake]]:after:absolute max-lg:[&_mark[data-highlight=mistake]]:after:inset-x-0 max-lg:[&_mark[data-highlight=mistake]]:after:-inset-y-2.5 max-lg:[&_mark[data-highlight=mistake]]:after:content-[''] [&_mark[data-highlight=mistake]]:cursor-pointer [&_mark[data-highlight=mistake]]:rounded-t-[0.2em] [&_mark[data-highlight=mistake]]:bg-destructive/10 [&_mark[data-highlight=mistake]]:text-inherit [&_mark[data-highlight=mistake]]:shadow-[inset_0_-2px_0_var(--destructive)] [&_mark[data-highlight=mistake]]:outline-none [&_mark[data-highlight=mistake]]:transition-colors [&_mark[data-highlight=mistake]]:[box-decoration-break:clone] [&_mark[data-highlight=mistake]:hover]:bg-destructive/20 [&_mark[data-highlight=mistake][data-open]]:bg-destructive/20 [&_mark[data-highlight=mistake]:focus-visible]:outline-2 [&_mark[data-highlight=mistake]:focus-visible]:outline-offset-2 [&_mark[data-highlight=mistake]:focus-visible]:outline-ring";

/** The grade's result, once it is in. */
const resultOf = (grade: Grade) => (grade.status === "graded" ? grade.result : undefined);

/** The Highlights of a grade, as CardText marks them: the missing ones in the Back, the mistakes in your answer. */
export function highlightsOf(result: GradeResponse | undefined): {
  missing: Highlight[];
  mistakes: Highlight[];
} {
  return {
    missing: (result?.missing ?? []).map((r, n) => ({ ...r, kind: "missing", n })),
    mistakes: (result?.mistakes ?? []).map((m, n) => ({
      from: m.from,
      to: m.to,
      kind: "mistake",
      n,
    })),
  };
}

/** After Check: your answer, the Back and the Feedback, with the Highlights. */
export function GradedCard({
  session,
  state,
  grade,
}: {
  session: StudySession;
  state: StudyState;
  grade: Grade;
}) {
  const card = state.shown?.card;
  const result = resultOf(grade);
  const { missing, mistakes } = useMemo(() => highlightsOf(result), [result]);
  const feedback = useRef<HTMLElement>(null);
  const [chat] = useChat();
  if (card === undefined) return null;
  return (
    <>
      <div
        aria-hidden
        className="my-6 h-px w-16 bg-border [view-transition-name:card-rule] lg:my-8"
      />
      <div
        className={cn(
          "grid gap-x-12 gap-y-8",
          chat.open
            ? "lg:grid-cols-[minmax(0,1fr)_22rem] lg:grid-rows-[auto_auto_1fr] xl:grid-cols-[minmax(0,1fr)_26rem]"
            : "lg:grid-cols-[minmax(0,1fr)_19rem] xl:grid-cols-[minmax(0,1fr)_22rem]",
        )}
      >
        <YourAnswer
          key={card.id}
          written={state.written ?? ""}
          mistakes={mistakes}
          notes={result?.mistakes.map((m) => m.note) ?? []}
        />
        <aside
          ref={feedback}
          aria-label="Feedback"
          className={cn(
            "min-w-0 lg:col-start-2 lg:row-start-1",
            chat.open ? "lg:row-span-3" : "lg:row-span-2",
          )}
        >
          <div
            className={cn(
              "flex flex-col gap-2",
              // PROTOTYPE (BAN-42): with the chat open, the margin runs down the page instead.
              !chat.open &&
                "lg:sticky lg:top-[calc(4.5rem+env(safe-area-inset-top))] lg:max-h-[calc(100dvh-14rem)] lg:overflow-y-auto lg:pb-2",
            )}
          >
            <h2 className={cn(LABEL, "flex min-h-5 items-center")}>Feedback</h2>
            <Feedback session={session} grade={grade} />
            <MarginChat />
          </div>
        </aside>
        <section
          aria-label="Answer"
          className="flex min-w-0 flex-col gap-2 lg:col-start-1 lg:row-start-2"
        >
          <div className="flex min-h-5 items-center justify-between gap-2">
            <h2 className={LABEL}>Answer</h2>
            {missing.length > 0 && (
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
            key={`${card.id}-back`}
            text={card.back}
            interactive
            highlights={missing}
            className={cn(
              "text-lg leading-relaxed [view-transition-name:card-back] lg:text-xl",
              MISSING_MARKS,
            )}
          />
        </section>
      </div>
      <FeedbackTab target={feedback} session={session} grade={grade} />
    </>
  );
}

/** Your answer, its mistakes marked; each opens its note in a bubble just under it. */
function YourAnswer({
  written,
  mistakes,
  notes,
}: {
  written: string;
  mistakes: Highlight[];
  /** Each mistake's note, by its `n`. */
  notes: string[];
}) {
  const box = useRef<HTMLDivElement>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const { shown } = useMistakeNotes(
    box,
    bubble,
    (n) => `Mistake ${n + 1} of ${notes.length}: show why`,
  );
  const note = shown === undefined ? undefined : notes[shown.n];
  // A mistake whose range has nothing to mark (only markup, a newline) has no
  // mark to open its note from: its note is listed under your answer instead.
  // (Your answer is new only with a new Card, which remounts this.)
  const [unmarked, setUnmarked] = useState<number[]>([]);
  useLayoutEffect(() => {
    const root = box.current;
    if (root === null) return;
    const marked = new Set(
      [...root.querySelectorAll<HTMLElement>("mark[data-highlight=mistake]")].map((m) =>
        Number(m.dataset["n"]),
      ),
    );
    const missing = mistakes.map((m) => m.n).filter((n) => !marked.has(n));
    setUnmarked((old) => (old.join() === missing.join() ? old : missing));
  }, [mistakes]);
  return (
    <section
      aria-label="Your answer"
      className="flex min-w-0 flex-col gap-2 lg:col-start-1 lg:row-start-1"
    >
      <div className="flex min-h-5 items-center justify-between gap-2">
        <h2 className={LABEL}>Your answer</h2>
        {mistakes.length > 0 && (
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
        {shown !== undefined && note !== undefined && (
          <Bubble ref={bubble} box={box} n={shown.n} note={note} />
        )}
      </div>
      {unmarked.length > 0 && (
        <ul aria-label="Other mistakes" className="flex flex-col gap-1.5 text-sm leading-relaxed">
          {unmarked.map((n) => (
            <li key={n} className="flex gap-2">
              <span
                aria-hidden
                className="mt-[0.55em] size-1.5 shrink-0 rounded-full bg-destructive"
              />
              <CardText text={notes[n] ?? ""} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * A mistake's note, in a bubble just under the last line of its mark, its
 * point at the mark. Placed before it paints, it shows at once, where it
 * belongs. The pointer goes through it, to a mistake it covers.
 */
function Bubble({
  ref,
  box,
  n,
  note,
}: {
  ref: RefObject<HTMLDivElement | null>;
  box: RefObject<HTMLDivElement | null>;
  n: number;
  note: string;
}) {
  const [at, setAt] = useState<{ top: number; left: number; point: number } | undefined>();
  useLayoutEffect(() => {
    const root = box.current;
    const self = ref.current;
    if (root === null || self === null) return () => {};
    const place = () => {
      const line = lastLineOf(root, n);
      if (line === undefined) return;
      const width = self.offsetWidth;
      const anchor = Math.min(line.right, line.left + 40);
      const left = Math.max(8, Math.min(root.clientWidth - width - 8, anchor - 28));
      setAt({
        top: line.bottom + 10,
        left,
        point: Math.max(16, Math.min(width - 16, anchor - left)),
      });
    };
    place();
    if (typeof ResizeObserver === "undefined") return () => {};
    const observer = new ResizeObserver(place);
    observer.observe(root);
    return () => observer.disconnect();
  }, [box, ref, n]);
  return (
    <div
      ref={ref}
      role="note"
      aria-live="polite"
      data-mistake-note={n}
      style={at ? { top: at.top, left: at.left } : { visibility: "hidden", top: 0, left: 0 }}
      className="pointer-events-none absolute z-20 w-[min(21rem,calc(100%-1rem))] rounded-xl border border-destructive/30 bg-card px-3.5 py-3 shadow-lg"
    >
      <span
        aria-hidden
        style={{ left: at?.point ?? 16 }}
        className="absolute -top-[0.35rem] size-2.5 -translate-x-1/2 rotate-45 border-t border-l border-destructive/30 bg-card"
      />
      <p className="mb-1 text-[0.7rem] font-semibold tracking-[0.08em] text-destructive uppercase">
        Why it's wrong
      </p>
      <CardText text={note} className="text-sm leading-relaxed" />
    </div>
  );
}

/** "Suggests Good", with the suggestion in the accent. */
function Suggests({ rating }: { rating: Rating }) {
  return (
    <>
      <Sparkles aria-hidden className="size-4 shrink-0 text-primary" />
      <span className="text-muted-foreground">
        Suggests <span className="font-semibold text-primary">{RATING_LABELS[rating]}</span>
      </span>
    </>
  );
}

/**
 * Below 1024 px, once the Feedback has scrolled away under the top bar: a tab
 * under it with the suggestion, which drops the Feedback down over the Back.
 */
function FeedbackTab({
  target,
  session,
  grade,
}: {
  target: RefObject<HTMLElement | null>;
  session: StudySession;
  grade: Grade;
}) {
  const [past, setPast] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const el = target.current;
    if (el === null || typeof IntersectionObserver === "undefined") return () => {};
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry === undefined) return;
        const gone = !entry.isIntersecting && entry.boundingClientRect.top < 120;
        setPast(gone);
        // Back in view, the tab goes, and opens shut next time.
        if (!gone) setOpen(false);
      },
      { rootMargin: "-56px 0px 0px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [target]);
  if (!past) return null;
  const result = resultOf(grade);
  return (
    <div className={cn("fixed inset-x-0 z-[9] lg:hidden", UNDER_TOP_BAR)}>
      <div className="mx-auto max-w-2xl px-4 sm:px-8">
        <div className="overflow-hidden rounded-b-2xl border border-t-0 bg-background/95 shadow-md backdrop-blur">
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            className="flex h-11 w-full items-center gap-2 px-4 text-left text-sm"
          >
            {grade.status === "grading" ? (
              <>
                <LoaderCircle
                  aria-hidden
                  className="size-4 animate-spin text-muted-foreground motion-reduce:animate-none"
                />
                <span className="text-muted-foreground">Grading your answer…</span>
              </>
            ) : result ? (
              <Suggests rating={result.rating} />
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
            <div className="max-h-[55dvh] overflow-y-auto border-t p-1">
              <Feedback session={session} grade={grade} bare />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** The User's Model's display name, for a failure that names it. */
function useModelName(): string {
  const id = useQuery(settingsQueryOptions()).data?.settings.model;
  return MODELS.find((model) => model.id === id)?.name ?? "your Model";
}

/** Why there is no Feedback, with Open Settings, Try again or neither, as the failure calls for. */
function GradeFailed({ session, failure }: { session: StudySession; failure: GradeFailure }) {
  const model = useModelName();
  const action = GRADE_FAILURE_ACTIONS[failure];
  return (
    <div role="alert" className="flex flex-col gap-3 rounded-xl border border-destructive/30 p-4">
      <p className="flex items-start gap-2 text-sm leading-relaxed text-destructive">
        <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
        {gradeFailureMessage(failure, model)}
      </p>
      {action === "settings" && (
        <Button
          variant="outline"
          className={cn(PILL, "h-11 self-start no-underline lg:h-9")}
          render={<Link to="/settings" />}
          nativeButton={false}
        >
          Open Settings
        </Button>
      )}
      {action === "retry" && (
        <Button
          variant="outline"
          className={cn(PILL, "h-11 self-start lg:h-9")}
          onClick={() => session.regrade()}
        >
          Try again
        </Button>
      )}
    </div>
  );
}

/** The Feedback, its place held while the Grader works, or why there is none. */
function Feedback({
  session,
  grade,
  bare = false,
}: {
  session: StudySession;
  grade: Grade;
  /** Inside the tab, without its own frame or the suggestion the tab shows. */
  bare?: boolean;
}) {
  if (grade.status === "failed") return <GradeFailed session={session} failure={grade.failure} />;
  if (grade.status === "grading") {
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
        {["w-11/12", "w-4/5", "w-2/3"].map((width) => (
          <span
            key={width}
            aria-hidden
            className={cn(
              "h-2.5 animate-pulse rounded-full bg-muted motion-reduce:animate-none",
              width,
            )}
          />
        ))}
      </div>
    );
  }
  if (grade.status === "skipped") {
    return (
      <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
        Rated before the Grader answered.
      </p>
    );
  }
  const { result } = grade;
  return (
    <div className={cn("flex flex-col gap-4 p-4", !bare && "rounded-xl border bg-card")}>
      {!bare && (
        <p className="flex items-center gap-2 text-sm">
          <Suggests rating={result.rating} />
        </p>
      )}
      <CardText
        text={result.feedback}
        interactive
        className="text-sm leading-relaxed lg:text-[0.95rem] [&_ol]:flex [&_ol]:flex-col [&_ol]:gap-2"
      />
    </div>
  );
}

/**
 * The dock after Check: the four ratings, the suggestion filled in on its
 * own, and over a Rating selected before it, Confirm.
 */
export function GradedRatings({
  session,
  state,
  grade,
}: {
  session: StudySession;
  state: StudyState;
  grade: Grade;
}) {
  const intervals = state.shown?.intervals;
  const suggested = resultOf(grade)?.rating;
  const confirming = grade.status === "grading" ? grade.selected : undefined;
  return (
    <div className="flex flex-col gap-2">
      <p className="flex min-h-5 items-center justify-center gap-1.5 text-center text-xs font-medium text-muted-foreground">
        <Hint grade={grade} />
      </p>
      <div className="relative grid grid-cols-4 rounded-2xl border bg-card">
        {confirming !== undefined && (
          <ConfirmCallout rating={confirming} disabled={!state.ratable} session={session} />
        )}
        {RATINGS.map((rating, i) => {
          const selected = grade.selected === rating && grade.status !== "skipped";
          const isSuggested = suggested === rating;
          return (
            <button
              key={rating}
              type="button"
              data-rating={rating}
              aria-pressed={grade.status === "grading" ? selected : undefined}
              disabled={!state.ratable}
              onClick={() => session.rate(rating)}
              aria-label={`${RATING_LABELS[rating]}${intervals ? `, ${formatInterval(intervals[rating], state.previewedAt)}` : ""}${isSuggested ? ", suggested" : ""}`}
              className={cn(
                "relative flex h-[4.5rem] flex-col items-center justify-center gap-0.5 outline-none transition-colors hover:bg-muted focus-visible:z-10 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 lg:h-16",
                i > 0 && "border-l",
                i === 0 && "rounded-l-2xl",
                i === RATINGS.length - 1 && "rounded-r-2xl",
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

/** Above the ratings: what a tap does now. */
function Hint({ grade }: { grade: Grade }): ReactNode {
  if (grade.status === "grading") {
    return grade.selected === undefined ? (
      <>
        <LoaderCircle aria-hidden className="size-3.5 animate-spin motion-reduce:animate-none" />
        Grading… pick a rating to confirm it now, or wait for the suggestion
      </>
    ) : (
      <span className="sr-only">Still grading</span>
    );
  }
  if (grade.status === "graded") {
    return (
      <>
        Tap any rating to save it
        <span className="hidden lg:inline">
          {" "}
          · Enter takes {RATING_LABELS[grade.selected ?? grade.result.rating]}
        </span>
      </>
    );
  }
  if (grade.status === "failed") return <>Not graded: rate it yourself</>;
  return null;
}

/** Over the ratings, above the one selected before the suggestion: Confirm, with Enter. */
function ConfirmCallout({
  rating,
  disabled,
  session,
}: {
  rating: Rating;
  disabled: boolean;
  session: StudySession;
}) {
  const at = RATINGS.indexOf(rating);
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-full z-20 mb-2 grid grid-cols-4">
      <div
        style={{ gridColumnStart: at + 1 }}
        className={cn(
          "relative flex",
          at === 0 ? "justify-start" : at === RATINGS.length - 1 ? "justify-end" : "justify-center",
        )}
      >
        <Button
          className={cn(
            PILL,
            "pointer-events-auto h-11 gap-1.5 px-5 whitespace-nowrap shadow-lg lg:h-9",
          )}
          disabled={disabled}
          onClick={() => session.confirm()}
          // A click leaves no focus behind, so the study keys still work.
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
