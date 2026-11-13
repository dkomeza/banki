import { DEFAULT_AUTO_CLOSE } from "@banki/shared";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Check, LoaderCircle, TextCursorInput } from "lucide-react";
import { SAVE_KEY } from "@/components/cards/card-editor";
import { LiveEditor } from "@/components/editor/live-editor";
import { useFinePointer } from "@/components/folders/drag";
import { OUTLINE_PILL, PILL } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import { settingsQueryOptions } from "@/lib/settings";
import { RATE_FAILED, type StudySession, type StudyState, formatInterval } from "@/lib/study";
import { cn } from "@/lib/utils";

// Write-and-grade on the study screen ("Sheet"): the Write toggle in the top
// bar switches the Answer mode, and the Written answer is written on a ruled
// sheet under the Front, like the card editor's fields. I don't know and
// Check share the dock. After Check the Grader's result shows (grade.tsx);
// after I don't know the Back shows with Next.

/** A section's label on the study screen: small capitals. */
export const LABEL = "text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase";

/** In the top bar, before Edit: pressed in write-and-grade; once the Card is revealed, it waits for the next. */
export function WriteToggle({ session, state }: { session: StudySession; state: StudyState }) {
  const on = state.mode === "write";
  return (
    <Button
      variant="ghost"
      aria-pressed={on}
      disabled={!state.switchable}
      onClick={() => session.setMode(on ? "self-rate" : "write")}
      // A click leaves no focus behind, so the study keys still work.
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

/**
 * The answer editor under the Front: the card editor's field on ruled lines,
 * with the Deck's Macros, but no Images (a Written answer isn't stored, so
 * one would be orphaned). Focused as the Card shows with a fine pointer; on
 * touch, not, so the keyboard doesn't cover the Card before it is read.
 * Ctrl/⌘+Enter checks.
 */
export function AnswerEditor({ session, state }: { session: StudySession; state: StudyState }) {
  const autoClose = useQuery(settingsQueryOptions()).data?.settings.autoClose ?? DEFAULT_AUTO_CLOSE;
  const fine = useFinePointer();
  return (
    <div data-answer-editor className="mt-8 flex flex-col gap-2">
      <span id="answer-label" className={LABEL}>
        Your answer
      </span>
      <LiveEditor
        value={state.draft}
        onChange={(draft) => session.setDraft(draft)}
        placeholder="Write it as you'd say it…"
        labelledBy="answer-label"
        autoFocus={fine}
        autoClose={autoClose}
        toolbarLabel="Answer formatting"
        onSubmit={() => session.check()}
        className="min-h-[8rem] w-full rounded-md bg-[repeating-linear-gradient(to_bottom,transparent_0,transparent_calc(2rem-1px),var(--border)_calc(2rem-1px),var(--border)_2rem)] text-lg leading-[2rem]"
      />
    </div>
  );
}

/**
 * Before the reveal in write-and-grade: I don't know, then Check, the wider;
 * Check waits for an answer. In handwriting it waits, for now: there is no ink
 * to send yet.
 */
export function WriteDock({
  session,
  state,
  handwriting = false,
}: {
  session: StudySession;
  state: StudyState;
  handwriting?: boolean;
}) {
  return (
    <div className="grid grid-cols-[1fr_2fr] gap-2">
      <Button
        variant="outline"
        className={cn(OUTLINE_PILL, "h-[4.5rem] text-base text-foreground lg:h-16")}
        disabled={!state.editable}
        onClick={() => session.dontKnow()}
        onMouseDown={(event) => event.preventDefault()}
      >
        I don't know
      </Button>
      <Button
        className={cn(PILL, "h-[4.5rem] text-base lg:h-16")}
        disabled={!state.checkable || handwriting}
        onClick={() => session.check()}
        onMouseDown={(event) => event.preventDefault()}
      >
        <Check aria-hidden className="size-5" />
        Check
        <kbd
          aria-hidden
          className="ml-1 hidden rounded border border-primary-foreground/30 px-1.5 font-sans text-[0.7rem] lg:inline"
        >
          {SAVE_KEY}+Enter
        </kbd>
      </Button>
    </div>
  );
}

/** After I don't know: Again saved, and Next for the next Card. */
export function DontKnowDock({ session, state }: { session: StudySession; state: StudyState }) {
  const again = state.shown?.intervals.again;
  const saved = state.saving === undefined && state.failure !== RATE_FAILED;
  return (
    <div className="flex flex-col gap-2">
      {saved && (
        <p className="text-center text-xs font-medium text-muted-foreground">
          Saved as <span className="text-destructive">Again</span>
          {again !== undefined && <> · back in {formatInterval(again, state.previewedAt)}</>}
        </p>
      )}
      <Button
        className={cn(PILL, "h-[4.5rem] w-full text-base lg:h-16")}
        disabled={!saved || state.skipping || state.undoing || state.failure !== undefined}
        onClick={() => session.next()}
      >
        {state.saving !== undefined || state.skipping ? (
          <LoaderCircle aria-label="Saving" className="size-5 animate-spin" />
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
