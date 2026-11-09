import type { GradeResponse } from "@banki/shared";
import { ArrowLeft, ChevronDown, MessageCircleQuestion, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { CardText } from "@/components/cards/card-text";
import { PILL } from "@/components/settings/parts";
import { LABEL } from "@/components/study/answer";
import { Composer, ComposerHint, LongChatAdvice, Message } from "@/components/study/chat-parts";
import { replying, requestedState, useChat } from "@/components/study/chat-proto";
import { Button } from "@/components/ui/button";
import { RATING_LABELS } from "@/lib/study";
import { cn } from "@/lib/utils";

// PROTOTYPE (BAN-42), Variant h, "Conversation": asking is a mode of the
// study screen, not a panel beside it. "Ask the Grader" under the Feedback
// turns the graded screen into the conversation: the Front stays at the top,
// the thread takes the reading column, and the grade folds into a small
// context card (a sticky margin from 1024 px, a bar that drops down below
// it). Nothing floats or overlaps: the chat is the page while it is open.
// "Back to the card" turns it back, with the chat kept behind the button.
// The dock, with the ratings, stays under both.

// In `chat-empty`, or opened by a tap, the input takes the focus; the other states open unfocused.
const FOCUS_ON_OPEN = ["graded", "chat-empty", undefined].includes(requestedState());

/** Under the Feedback: the way into the conversation, and back to it once started. */
export function AskButton() {
  const [chat, actions, live] = useChat();
  if (!live) return null;
  const count = chat.messages.length;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-2">
      <Button
        variant="outline"
        className={cn(PILL, "h-11 gap-2 border-border px-4 text-foreground lg:h-9")}
        onClick={actions.open}
      >
        <MessageCircleQuestion aria-hidden className="size-4 text-primary" />
        {count === 0 ? "Ask the Grader" : "Back to the chat"}
        {count > 0 && (
          <span className="rounded-full bg-muted px-1.5 text-xs text-muted-foreground tabular-nums">
            {count}
          </span>
        )}
      </Button>
      {count === 0 && <span className="text-xs text-muted-foreground">"Why is that wrong?"</span>}
    </div>
  );
}

const STARTERS = ["Why is that wrong?", "Show me the right step."];

/** The study screen while the chat is open: the thread, with the grade beside it as context. */
export function Conversation({ result }: { result: GradeResponse }) {
  const [chat, actions] = useChat();
  const end = useRef<HTMLDivElement>(null);
  const count = chat.messages.length;
  // Opening, and each message sent, bring the input into view.
  const seen = useRef(-1);
  useEffect(() => {
    if (count > seen.current) end.current?.scrollIntoView({ block: "end" });
    seen.current = count;
  }, [count]);
  return (
    <>
      <div
        aria-hidden
        className="my-6 h-px w-16 bg-border [view-transition-name:card-rule] lg:my-8"
      />
      <div className="grid flex-1 gap-x-12 gap-y-6 lg:grid-cols-[minmax(0,1fr)_19rem] xl:grid-cols-[minmax(0,1fr)_22rem]">
        <aside
          aria-label="The grade"
          className="min-w-0 max-lg:hidden lg:col-start-2 lg:row-start-1"
        >
          <GradeContext result={result} at="margin" />
        </aside>
        <section
          aria-label="Follow-up chat"
          className="flex min-w-0 flex-col gap-4 lg:col-start-1 lg:row-start-1"
        >
          {/* Below 1024 px the grade stays in reach, a bar under the top bar. */}
          <div className="sticky top-[calc(3.5rem+env(safe-area-inset-top))] z-[9] -mt-2 pt-2 lg:hidden">
            <GradeContext result={result} at="bar" />
          </div>
          <div className="flex min-h-5 items-center justify-between gap-2">
            <h2 className={cn(LABEL, "flex items-center gap-2")}>
              <MessageCircleQuestion aria-hidden className="size-3.5 text-primary" />
              Asking the Grader
            </h2>
            <Button
              variant="ghost"
              className="-mr-3 h-11 gap-1.5 rounded-full px-3 text-sm text-muted-foreground lg:h-8"
              onClick={actions.close}
            >
              <ArrowLeft aria-hidden className="size-4" />
              Back to the card
            </Button>
          </div>
          {count === 0 ? (
            <div className="flex flex-col gap-3 py-2">
              <p className="text-[0.95rem] leading-relaxed text-muted-foreground">
                Ask about this card: why a step is wrong, or how to get it right. The Grader answers
                about this card only, and it won't change its suggestion.
              </p>
              <div className="flex flex-wrap gap-2">
                {STARTERS.map((starter) => (
                  <Button
                    key={starter}
                    variant="outline"
                    className={cn(PILL, "h-11 border-dashed px-4 text-foreground lg:h-8")}
                    onClick={() => actions.setDraft(starter)}
                  >
                    {starter}
                  </Button>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-6">
              {chat.messages.map((message) => (
                <Message key={message.id} message={message} actions={actions} />
              ))}
            </div>
          )}
          <LongChatAdvice chat={chat} />
          <div
            ref={end}
            className="sticky bottom-[calc(7.75rem+env(safe-area-inset-bottom))] mt-auto flex scroll-mb-36 flex-col gap-1.5 bg-background/95 pt-2 pb-2 backdrop-blur max-lg:[&:focus-within]:bottom-0 lg:bottom-[7.25rem]"
          >
            <Composer chat={chat} actions={actions} autoFocus={FOCUS_ON_OPEN} />
            <ComposerHint className="px-1" />
          </div>
        </section>
      </div>
    </>
  );
}

/**
 * The grade, folded small: the suggestion, and the Feedback and mistakes a
 * tap away below 1024 px, or in a sticky margin from there.
 */
function GradeContext({ result, at }: { result: GradeResponse; at: "bar" | "margin" }) {
  const [chat] = useChat();
  const [open, setOpen] = useState(false);
  const mistakes = result.mistakes.length;
  const summary = (
    <span className="flex min-w-0 items-center gap-2 text-sm">
      <Sparkles aria-hidden className="size-4 shrink-0 text-primary" />
      <span className="truncate text-muted-foreground">
        Suggests <span className="font-semibold text-primary">{RATING_LABELS[result.rating]}</span>
        {mistakes > 0 && (
          <>
            {" · "}
            <span className="text-destructive">
              {mistakes} {mistakes === 1 ? "mistake" : "mistakes"}
            </span>
          </>
        )}
        {replying(chat) && " · still suggests it"}
      </span>
    </span>
  );
  const details = (
    <div className="flex flex-col gap-3">
      <CardText
        text={result.feedback}
        interactive
        className="text-sm leading-relaxed [&_ol]:flex [&_ol]:flex-col [&_ol]:gap-2"
      />
      {mistakes > 0 && (
        <ul aria-label="Mistakes" className="flex flex-col gap-1.5 border-t pt-3 text-sm">
          {result.mistakes.map((m, n) => (
            // oxlint-disable-next-line react/no-array-index-key -- the grade's mistakes never reorder.
            <li key={n} className="flex gap-2 leading-relaxed">
              <span className="mt-0.5 shrink-0 text-xs font-semibold text-destructive tabular-nums">
                {n + 1}
              </span>
              <CardText text={m.note} />
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">
        The chat never changes the suggestion. Rate whenever you're ready.
      </p>
    </div>
  );
  return (
    <>
      {/* Below 1024 px: a bar that drops the grade down. */}
      {at === "bar" && (
        <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            className="flex h-12 w-full items-center gap-2 px-4 text-left"
          >
            {summary}
            <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-xs font-medium text-muted-foreground">
              {open ? "Hide" : "Feedback"}
              <ChevronDown
                aria-hidden
                className={cn("size-4 transition-transform", open && "rotate-180")}
              />
            </span>
          </button>
          {open && <div className="border-t px-4 py-3">{details}</div>}
        </div>
      )}
      {/* From 1024 px: the margin, where the Feedback was. */}
      {at === "margin" && (
        <div className="sticky top-[calc(4.5rem+env(safe-area-inset-top))] flex max-h-[calc(100dvh-14rem)] flex-col gap-2 overflow-y-auto pb-2">
          <h2 className={cn(LABEL, "flex min-h-5 items-center")}>Feedback</h2>
          <div className="flex flex-col gap-4 rounded-xl border bg-card p-4">
            {summary}
            {details}
          </div>
        </div>
      )}
    </>
  );
}
