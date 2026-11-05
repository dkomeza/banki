import { DEFAULT_AUTO_CLOSE } from "@banki/shared";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import { CardText } from "@/components/cards/card-text";
import { LiveEditor } from "@/components/editor/live-editor";
import {
  type AnswerActions,
  type AnswerMode,
  type AnswerProto,
  answerProto,
  finePointer,
  isBlank,
} from "@/components/study/answer-proto";
import type { Card } from "@/lib/cards";
import { settingsQueryOptions } from "@/lib/settings";
import { type StudyState, formatInterval } from "@/lib/study";
import { cn } from "@/lib/utils";

export type { AnswerActions } from "@/components/study/answer-proto";

// PROTOTYPE (BAN-38), Variant c, "Margin": the switch belongs to the Card, a
// quiet "Answer by rating / writing" line under the Front where "Tap anywhere
// to reveal" was. What is written and what is revealed are rows with their
// label in the left margin, like the card editor's Front and Back, so the
// Written answer and the Back line up as two entries of one ledger. The dock
// keeps the rating bar's shape at every step: I don't know | Check, then the
// four ratings, or Again (saved) | Next.

const MOD = typeof navigator !== "undefined" && /Mac|iP/.test(navigator.platform) ? "⌘" : "Ctrl";

const MODES: readonly { mode: AnswerMode; label: string }[] = [
  { mode: "self-rate", label: "rating myself" },
  { mode: "write", label: "writing" },
];

const LABEL =
  "pt-1 text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase sm:w-16 sm:shrink-0 sm:pt-1.5 sm:text-right";

/** A ledger row: its label in the left margin from 640 px, above it on phones. */
function Row({
  label,
  id,
  accent = false,
  children,
}: {
  label: string;
  id: string;
  accent?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      className="flex flex-col gap-1 sm:-ml-[5.5rem] sm:flex-row sm:gap-6"
    >
      <h2 id={id} className={cn(LABEL, accent && "text-primary")}>
        {label}
      </h2>
      <div className="min-w-0 flex-1">{children}</div>
    </section>
  );
}

export const TopBarSwitch: (props: {
  state: StudyState;
  proto: AnswerProto;
  answer: AnswerActions;
}) => null = () => null;

export const DockSwitch: (props: {
  state: StudyState;
  proto: AnswerProto;
  answer: AnswerActions;
}) => null = () => null;

/** "Answer by rating myself · writing", under the Front until the reveal. */
function ModeLine({ proto, answer }: { proto: AnswerProto; answer: AnswerActions }) {
  return (
    <div
      role="radiogroup"
      aria-label="Answer mode"
      className="-ml-1 flex flex-wrap items-center gap-x-1 text-sm text-muted-foreground"
    >
      <span className="pl-1">Answer by</span>
      {MODES.map(({ mode, label }, i) => (
        <span key={mode} className="flex items-center gap-1">
          {i > 0 && <span aria-hidden>·</span>}
          <button
            type="button"
            role="radio"
            aria-checked={proto.mode === mode}
            onClick={(event) => {
              event.stopPropagation();
              answer.setMode(mode);
            }}
            onMouseDown={(event) => event.preventDefault()}
            className={cn(
              "h-11 rounded-md px-1 underline-offset-[6px] outline-none focus-visible:outline-2 focus-visible:outline-ring lg:h-8",
              proto.mode === mode
                ? "font-medium text-foreground underline decoration-primary decoration-2"
                : "hover:text-foreground",
            )}
          >
            {label}
          </button>
        </span>
      ))}
    </div>
  );
}

/** Under the Front until the reveal: the mode line, then the hint or the answer editor. */
export function UnderFront({
  proto,
  answer,
}: {
  state: StudyState;
  proto: AnswerProto;
  answer: AnswerActions;
}) {
  const autoClose = useQuery(settingsQueryOptions()).data?.settings.autoClose ?? DEFAULT_AUTO_CLOSE;
  const host = useRef<HTMLDivElement>(null);
  const writing = proto.mode === "write";
  useEffect(() => {
    if (!writing || !answerProto.get().cheatsheet) return;
    answerProto.set({ cheatsheet: false });
    host.current?.querySelector<HTMLButtonElement>('[aria-label="LaTeX cheatsheet"]')?.click();
  }, [writing]);
  return (
    <div ref={host} className="mt-6 flex flex-col gap-6 lg:mt-8">
      <ModeLine proto={proto} answer={answer} />
      {writing ? (
        <Row label="Yours" id="answer-label">
          <LiveEditor
            value={proto.draft}
            onChange={answer.setDraft}
            placeholder="Your answer, Formulas and all"
            labelledBy="answer-label"
            autoFocus={finePointer()}
            autoClose={autoClose}
            toolbarLabel="Answer formatting"
            onSubmit={answer.check}
            className="min-h-[8rem] w-full border-l-2 border-primary/50 pl-4 text-lg leading-relaxed"
          />
        </Row>
      ) : (
        <p className="text-sm text-muted-foreground">Tap anywhere to reveal</p>
      )}
    </div>
  );
}

/** Revealed: the ledger, Yours over Back after Check, Back alone otherwise. */
export function RevealedBody({
  card,
  proto,
}: {
  card: Card;
  state: StudyState;
  proto: AnswerProto;
}) {
  const written = proto.step === "checked" && !isBlank(proto.draft);
  return (
    <div className="mt-8 flex flex-col gap-8 lg:mt-10">
      {written && (
        <Row label="Yours" id="written-label">
          <CardText
            text={proto.draft}
            className="border-l-2 border-border pl-4 text-lg leading-relaxed text-muted-foreground"
          />
        </Row>
      )}
      <Row label="Back" id="back-label" accent={written}>
        <CardText
          key={`${card.id}-back`}
          text={card.back}
          interactive
          className={cn(
            "text-lg leading-relaxed [view-transition-name:card-back] lg:text-xl",
            written && "border-l-2 border-primary pl-4",
          )}
        />
      </Row>
    </div>
  );
}

const BAR = "grid grid-cols-2 overflow-hidden rounded-2xl border bg-card";
const CELL =
  "relative flex h-[4.5rem] flex-col items-center justify-center gap-0.5 outline-none transition-colors focus-visible:z-10 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none lg:h-16";

/** Before the reveal in write-and-grade: the bar, I don't know | Check. */
export function DockWrite({
  state,
  proto,
  answer,
}: {
  state: StudyState;
  proto: AnswerProto;
  answer: AnswerActions;
}) {
  const blank = isBlank(proto.draft);
  return (
    <div className={BAR}>
      <button
        type="button"
        disabled={state.saving !== undefined}
        onClick={answer.dontKnow}
        className={cn(CELL, "hover:bg-muted disabled:opacity-50")}
      >
        <span className="text-base font-semibold">I don't know</span>
        <span className="text-xs font-medium text-destructive">Again</span>
      </button>
      <button
        type="button"
        disabled={blank}
        onClick={answer.check}
        onMouseDown={(event) => event.preventDefault()}
        className={cn(
          CELL,
          "border-l bg-primary text-primary-foreground hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground",
        )}
      >
        <span className="text-base font-semibold">Check</span>
        <span className="text-xs font-medium opacity-80">
          {blank ? "Write something first" : "See the Back"}
        </span>
        <kbd
          aria-hidden
          className="absolute top-1.5 right-2 hidden font-sans text-[0.65rem] lg:block"
        >
          {MOD}+Enter
        </kbd>
      </button>
    </div>
  );
}

/** After I don't know: the bar again, Again (saved) | Next. */
export function DontKnowDock({ state, answer }: { state: StudyState; answer: AnswerActions }) {
  const again = state.shown?.intervals.again;
  return (
    <div className={BAR}>
      <div className={cn(CELL, "text-muted-foreground")}>
        <span className="text-lg font-semibold text-foreground tabular-nums">
          {again !== undefined ? formatInterval(again, state.previewedAt) : "–"}
        </span>
        <span className="text-xs font-medium text-destructive">Again, saved</span>
      </div>
      <button
        type="button"
        disabled={state.saving !== undefined}
        onClick={answer.next}
        className={cn(CELL, "border-l bg-primary text-primary-foreground hover:bg-primary/90")}
      >
        {state.saving !== undefined ? (
          <LoaderCircle aria-hidden className="size-5 animate-spin" />
        ) : (
          <span className="flex items-center gap-2 text-base font-semibold">
            Next
            <ArrowRight aria-hidden className="size-5" />
          </span>
        )}
        <kbd
          aria-hidden
          className="absolute top-1.5 right-2 hidden font-sans text-[0.65rem] lg:block"
        >
          Enter
        </kbd>
      </button>
    </div>
  );
}
