import { DEFAULT_AUTO_CLOSE } from "@banki/shared";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { useEffect, useRef } from "react";
import { CardText } from "@/components/cards/card-text";
import { LiveEditor } from "@/components/editor/live-editor";
import { PILL } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
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

// PROTOTYPE (BAN-38), Variant b, "Dock": everything about answering lives in
// the dock, in thumb reach: the switch, a segmented "Rate yourself / Write",
// sits above the action, with I don't know beside it and Check below at full
// width. The answer editor is a field of its own under the Front. After Check,
// from 1024 px, the Written answer and the Back sit side by side, to read
// across; stacked on phones.

const MOD = typeof navigator !== "undefined" && /Mac|iP/.test(navigator.platform) ? "⌘" : "Ctrl";

const MODES: readonly { mode: AnswerMode; label: string }[] = [
  { mode: "self-rate", label: "Rate yourself" },
  { mode: "write", label: "Write" },
];

export const TopBarSwitch: (props: {
  state: StudyState;
  proto: AnswerProto;
  answer: AnswerActions;
}) => null = () => null;

/** Above the dock's action until the reveal: the two modes, and in write-and-grade I don't know. */
export function DockSwitch({
  state,
  proto,
  answer,
}: {
  state: StudyState;
  proto: AnswerProto;
  answer: AnswerActions;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div
        role="radiogroup"
        aria-label="Answer mode"
        className="inline-flex rounded-full border bg-muted/60 p-0.5"
      >
        {MODES.map(({ mode, label }) => (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={proto.mode === mode}
            disabled={state.editing}
            onClick={() => answer.setMode(mode)}
            onMouseDown={(event) => event.preventDefault()}
            className={cn(
              "h-11 rounded-full px-4 text-sm font-medium text-muted-foreground transition-colors outline-none focus-visible:outline-2 focus-visible:outline-ring lg:h-8 lg:px-3.5",
              proto.mode === mode && "bg-background text-foreground shadow-sm dark:bg-input/40",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {proto.mode === "write" && (
        <Button
          variant="ghost"
          className="h-11 rounded-full px-4 text-sm font-medium text-muted-foreground lg:h-8 lg:px-3.5"
          disabled={state.saving !== undefined}
          onClick={answer.dontKnow}
        >
          I don't know
        </Button>
      )}
    </div>
  );
}

/** The answer editor, a field of its own under the Front. No Images. */
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
  useEffect(() => {
    if (!answerProto.get().cheatsheet) return;
    answerProto.set({ cheatsheet: false });
    host.current?.querySelector<HTMLButtonElement>('[aria-label="LaTeX cheatsheet"]')?.click();
  }, []);
  return (
    <div ref={host} className="mt-8 lg:mt-10">
      <span id="answer-label" className="sr-only">
        Your answer
      </span>
      <LiveEditor
        value={proto.draft}
        onChange={answer.setDraft}
        placeholder="Type your answer…"
        labelledBy="answer-label"
        autoFocus={finePointer()}
        autoClose={autoClose}
        toolbarLabel="Answer formatting"
        onSubmit={answer.check}
        className="min-h-[9rem] w-full rounded-2xl border bg-card px-4 py-3 text-lg leading-relaxed shadow-xs transition-colors focus-within:border-ring lg:px-5 lg:py-4"
      />
    </div>
  );
}

/** Revealed: after Check, the Written answer and the Back side by side; after I don't know, a chip over the Back. */
export function RevealedBody({
  card,
  proto,
}: {
  card: Card;
  state: StudyState;
  proto: AnswerProto;
}) {
  const back = (
    <CardText
      key={`${card.id}-back`}
      text={card.back}
      interactive
      className="text-lg leading-relaxed [view-transition-name:card-back] lg:text-xl"
    />
  );
  if (proto.step === "checked" && !isBlank(proto.draft)) {
    return (
      <div className="mt-6 grid gap-6 lg:-mx-32 lg:mt-10 lg:grid-cols-2 lg:gap-8">
        <section aria-labelledby="written-label" className="flex flex-col gap-2">
          <h2
            id="written-label"
            className="text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase"
          >
            You wrote
          </h2>
          <div className="rounded-2xl border bg-card px-4 py-3 lg:px-5 lg:py-4">
            <CardText text={proto.draft} className="text-lg leading-relaxed" />
          </div>
        </section>
        <section aria-labelledby="back-label" className="flex flex-col gap-2">
          <h2
            id="back-label"
            className="text-xs font-semibold tracking-[0.08em] text-primary uppercase"
          >
            Answer
          </h2>
          <div className="lg:pt-3">{back}</div>
        </section>
      </div>
    );
  }
  return (
    <>
      <div
        aria-hidden
        className="my-6 h-px w-16 bg-border [view-transition-name:card-rule] lg:my-8"
      />
      {proto.step === "dont-know" && (
        <p className="mb-4 w-fit rounded-full bg-destructive/10 px-3 py-1 text-xs font-medium text-destructive">
          Not known: saved as Again
        </p>
      )}
      {back}
    </>
  );
}

/** Before the reveal in write-and-grade: Check, at full width under the switch. */
export function DockWrite({
  proto,
  answer,
}: {
  state: StudyState;
  proto: AnswerProto;
  answer: AnswerActions;
}) {
  return (
    <Button
      className={cn(PILL, "h-[4.5rem] w-full text-base lg:h-16")}
      disabled={isBlank(proto.draft)}
      onClick={answer.check}
      onMouseDown={(event) => event.preventDefault()}
    >
      Check
      <kbd
        aria-hidden
        className="ml-2 hidden rounded border border-primary-foreground/30 px-1.5 font-sans text-[0.7rem] lg:inline"
      >
        {MOD}+Enter
      </kbd>
    </Button>
  );
}

/** After I don't know: Next, with when the Card comes back. */
export function DontKnowDock({ state, answer }: { state: StudyState; answer: AnswerActions }) {
  const again = state.shown?.intervals.again;
  return (
    <Button
      className={cn(PILL, "h-[4.5rem] w-full justify-between px-6 text-base lg:h-16")}
      disabled={state.saving !== undefined}
      onClick={answer.next}
    >
      <span className="text-sm font-normal text-primary-foreground/80 tabular-nums">
        {again !== undefined && <>Back in {formatInterval(again, state.previewedAt)}</>}
      </span>
      <span className="flex items-center gap-2">
        {state.saving !== undefined ? (
          <LoaderCircle aria-hidden className="size-5 animate-spin" />
        ) : (
          <>
            Next
            <ArrowRight aria-hidden className="size-5" />
          </>
        )}
      </span>
      <kbd
        aria-hidden
        className="hidden rounded border border-primary-foreground/30 px-1.5 font-sans text-[0.7rem] lg:inline"
      >
        Enter
      </kbd>
    </Button>
  );
}
