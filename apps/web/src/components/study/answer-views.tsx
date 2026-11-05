import { DEFAULT_AUTO_CLOSE } from "@banki/shared";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Check, LoaderCircle, TextCursorInput } from "lucide-react";
import { useEffect, useRef } from "react";
import { CardText } from "@/components/cards/card-text";
import { LiveEditor } from "@/components/editor/live-editor";
import { OUTLINE_PILL, PILL } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import {
  type AnswerActions,
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

// PROTOTYPE (BAN-38), Variant a, "Sheet": the switch is a Write toggle in the
// top bar beside Edit, and write-and-grade is a ruled sheet under the Front,
// like the card editor's. Check and I don't know share the dock. After Check
// the Written answer sits on a muted slip above the Back, as a note to compare
// the Back with.

const MOD = typeof navigator !== "undefined" && /Mac|iP/.test(navigator.platform) ? "⌘" : "Ctrl";

/** In the top bar, before Edit: pressed in write-and-grade; waits for the next Card once revealed. */
export function TopBarSwitch({
  state,
  proto,
  answer,
}: {
  state: StudyState;
  proto: AnswerProto;
  answer: AnswerActions;
}) {
  const on = proto.mode === "write";
  return (
    <Button
      variant="ghost"
      aria-pressed={on}
      disabled={state.revealed || state.editing}
      onClick={() => answer.setMode(on ? "self-rate" : "write")}
      onMouseDown={(event) => event.preventDefault()}
      title={on ? "Write and grade: on" : "Write and grade"}
      aria-label="Write and grade"
      className={cn(
        "h-11 min-w-11 gap-1.5 rounded-full px-3 lg:h-9 lg:min-w-9",
        on && "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary",
      )}
    >
      <TextCursorInput aria-hidden className="size-4" />
      <span className="hidden sm:inline">Write</span>
    </Button>
  );
}

export const DockSwitch: (props: {
  state: StudyState;
  proto: AnswerProto;
  answer: AnswerActions;
}) => null = () => null;

/** The answer editor: the card editor's field, ruled, under the Front. No Images. */
function AnswerEditor({ proto, answer }: { proto: AnswerProto; answer: AnswerActions }) {
  const autoClose = useQuery(settingsQueryOptions()).data?.settings.autoClose ?? DEFAULT_AUTO_CLOSE;
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!answerProto.get().cheatsheet) return;
    answerProto.set({ cheatsheet: false });
    host.current?.querySelector<HTMLButtonElement>('[aria-label="LaTeX cheatsheet"]')?.click();
  }, []);
  return (
    <div ref={host} className="mt-8 flex flex-col gap-2">
      <span
        id="answer-label"
        className="text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase"
      >
        Your answer
      </span>
      <LiveEditor
        value={proto.draft}
        onChange={answer.setDraft}
        placeholder="Write it as you'd say it…"
        labelledBy="answer-label"
        autoFocus={finePointer()}
        autoClose={autoClose}
        toolbarLabel="Answer formatting"
        onSubmit={answer.check}
        className="min-h-[8rem] w-full rounded-md bg-[repeating-linear-gradient(to_bottom,transparent_0,transparent_calc(2rem-1px),var(--border)_calc(2rem-1px),var(--border)_2rem)] text-lg leading-[2rem]"
      />
    </div>
  );
}

export function UnderFront({
  proto,
  answer,
}: {
  state: StudyState;
  proto: AnswerProto;
  answer: AnswerActions;
}) {
  return <AnswerEditor proto={proto} answer={answer} />;
}

/** Revealed: the Written answer on its slip after Check, then the Back. */
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
    <>
      {written && (
        <section
          aria-label="Your answer"
          className="mt-6 rounded-xl border border-dashed bg-muted/50 px-4 py-3 lg:mt-8 lg:px-5 lg:py-4"
        >
          <h2 className="mb-1 text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
            Your answer
          </h2>
          <CardText text={proto.draft} className="text-base leading-relaxed lg:text-lg" />
        </section>
      )}
      <div
        aria-hidden
        className="my-6 h-px w-16 bg-border [view-transition-name:card-rule] lg:my-8"
      />
      {written && (
        <h2 className="mb-2 text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
          Answer
        </h2>
      )}
      <CardText
        key={`${card.id}-back`}
        text={card.back}
        interactive
        className="text-lg leading-relaxed [view-transition-name:card-back] lg:text-xl"
      />
    </>
  );
}

/** Before the reveal in write-and-grade: I don't know, then Check, the wider. */
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
    <div className="grid grid-cols-[1fr_2fr] gap-2">
      <Button
        variant="outline"
        className={cn(OUTLINE_PILL, "h-[4.5rem] text-base text-foreground lg:h-16")}
        disabled={state.saving !== undefined}
        onClick={answer.dontKnow}
      >
        I don't know
      </Button>
      <Button
        className={cn(PILL, "h-[4.5rem] text-base lg:h-16")}
        disabled={blank}
        onClick={answer.check}
        onMouseDown={(event) => event.preventDefault()}
      >
        <Check aria-hidden className="size-5" />
        Check
        <kbd
          aria-hidden
          className="ml-1 hidden rounded border border-primary-foreground/30 px-1.5 font-sans text-[0.7rem] lg:inline"
        >
          {MOD}+Enter
        </kbd>
      </Button>
    </div>
  );
}

/** After I don't know: Again is saved; Next loads the next Card. */
export function DontKnowDock({ state, answer }: { state: StudyState; answer: AnswerActions }) {
  const again = state.shown?.intervals.again;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-center text-xs font-medium text-muted-foreground">
        Saved as <span className="text-destructive">Again</span>
        {again !== undefined && <> · back in {formatInterval(again, state.previewedAt)}</>}
      </p>
      <Button
        className={cn(PILL, "h-[4.5rem] w-full text-base lg:h-16")}
        disabled={state.saving !== undefined}
        onClick={answer.next}
      >
        {state.saving !== undefined ? (
          <LoaderCircle aria-hidden className="size-5 animate-spin" />
        ) : (
          <>
            Next
            <ArrowRight aria-hidden className="size-5" />
          </>
        )}
        <kbd
          aria-hidden
          className="ml-1 hidden rounded border border-primary-foreground/30 px-1.5 font-sans text-[0.7rem] lg:inline"
        >
          Enter
        </kbd>
      </Button>
    </div>
  );
}
