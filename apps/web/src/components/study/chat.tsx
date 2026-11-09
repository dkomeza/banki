import {
  DEFAULT_AUTO_CLOSE,
  type GradeResponse,
  MODELS,
  WRITTEN_ANSWER_MAX_LENGTH,
} from "@banki/shared";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AlertCircle, ArrowUp, Scissors, Square } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef } from "react";
import { SAVE_KEY } from "@/components/cards/card-editor";
import { CardText } from "@/components/cards/card-text";
import { LiveEditor } from "@/components/editor/live-editor";
import { PILL } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import { settingsQueryOptions } from "@/lib/settings";
import { closedFormulas } from "@/lib/streaming-text";
import {
  CHAT_FAILURE_ACTIONS,
  type ChatEntry,
  type ChatFailure,
  chatFailureMessage,
  chatLength,
  LONG_CHAT,
  replying,
  type StudySession,
  type StudyState,
} from "@/lib/study";
import { cn } from "@/lib/utils";

// The Follow-up chat on the graded study screen ("Feedback thread"): there is
// no chat to open. The Feedback is the Grader's first message, and the reply
// field sits at the foot of the Feedback card from the moment the grade is
// in. Questions and replies go on inside that card, under the Feedback. From
// 1024 px the card stays in its sticky margin, and the thread scrolls inside
// it with the field pinned at its foot; below 1024 px the card grows with the
// thread, and the dock steps aside while the field has the focus.

/** A reply's Markdown, with LaTeX in the Deck's Macros. */
const REPLY_TEXT =
  "text-sm leading-relaxed lg:text-[0.95rem] [&_ol]:flex [&_ol]:flex-col [&_ol]:gap-1.5 [&_p+p]:mt-2";

/** A blinking caret after the last word of a streaming reply. */
const STREAM_CARET =
  "[&>*:last-child]:after:ml-0.5 [&>*:last-child]:after:inline-block [&>*:last-child]:after:h-[1em] [&>*:last-child]:after:w-[0.45em] [&>*:last-child]:after:translate-y-[0.15em] [&>*:last-child]:after:animate-pulse [&>*:last-child]:after:rounded-[1px] [&>*:last-child]:after:bg-primary [&>*:last-child]:after:content-[''] motion-reduce:[&>*:last-child]:after:animate-none";

/** The Feedback card once graded: the suggestion, the Feedback, the chat under it, and the field at its foot. */
export function FeedbackThread({
  session,
  state,
  result,
  suggests,
}: {
  session: StudySession;
  state: StudyState;
  result: GradeResponse;
  /** "Suggests Hard", as the Feedback shows it. */
  suggests: ReactNode;
}) {
  const { chat } = state;
  const scroller = useFollowedThread();
  const asked = chat.entries.length > 0;
  return (
    <section
      aria-label="Feedback and follow-up chat"
      className="flex min-h-0 flex-col rounded-xl border bg-card lg:flex-1"
    >
      <div
        ref={scroller}
        className="flex min-h-0 flex-col gap-4 p-4 lg:flex-1 lg:overflow-y-auto lg:overscroll-contain"
      >
        <p className="flex items-center gap-2 text-sm">{suggests}</p>
        <CardText
          text={result.feedback}
          interactive
          className="text-sm leading-relaxed lg:text-[0.95rem] [&_ol]:flex [&_ol]:flex-col [&_ol]:gap-2"
        />
        {asked && (
          <div
            role="log"
            aria-label="Follow-up chat"
            className="flex flex-col gap-4 border-t border-dashed pt-4"
          >
            {chat.entries.map((entry, i) => (
              // Entries only grow at the end, or the last is replaced in place.
              <Message
                key={i}
                entry={entry}
                session={session}
                latest={i === chat.entries.length - 1}
              />
            ))}
          </div>
        )}
        {chatLength(chat) >= LONG_CHAT && <LongChatAdvice />}
      </div>
      <div className="flex flex-col gap-1.5 border-t p-2">
        <Composer session={session} state={state} asked={asked} />
      </div>
    </section>
  );
}

/**
 * From 1024 px the thread scrolls in the card: it keeps to its newest words
 * as they come (and as Formulas typeset late), unless the User has scrolled up.
 */
function useFollowedThread() {
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scroller.current;
    if (el === null || typeof ResizeObserver === "undefined") return () => {};
    let atEnd = true;
    // Where following last scrolled to: its own scroll event, which can come
    // after the thread has grown again, isn't the User scrolling up.
    let followedTo: number | undefined;
    const onScroll = () => {
      if (followedTo !== undefined && Math.abs(el.scrollTop - followedTo) < 2) return;
      atEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    };
    const follow = () => {
      if (!atEnd) return;
      el.scrollTop = el.scrollHeight;
      followedTo = el.scrollTop;
    };
    const resized = new ResizeObserver(follow);
    const watch = () => {
      for (const child of el.querySelectorAll(":scope > *, [role=log] > *")) resized.observe(child);
    };
    const added = new MutationObserver(() => {
      watch();
      follow();
    });
    watch();
    added.observe(el, { childList: true, subtree: true });
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      resized.disconnect();
      added.disconnect();
      el.removeEventListener("scroll", onScroll);
    };
  }, []);
  return scroller;
}

/**
 * One message: the User's in a quiet bubble, the Grader's as plain text. Only
 * the `latest` reply can be asked for again: an earlier one that failed or
 * was cut off has been asked past.
 */
function Message({
  entry,
  session,
  latest,
}: {
  entry: ChatEntry;
  session: StudySession;
  latest: boolean;
}) {
  if (entry.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] min-w-0 rounded-2xl rounded-br-md bg-muted px-3.5 py-2.5">
          <CardText text={entry.text} className="text-sm leading-relaxed lg:text-[0.95rem]" />
        </div>
      </div>
    );
  }
  if (entry.status === "failed") {
    return <ReplyFailed session={session} failure={entry.failure} retry={latest} />;
  }
  const streaming = entry.status === "streaming";
  // While it streams, a Formula shows once it is closed.
  const text = streaming ? closedFormulas(entry.text) : entry.text;
  return (
    <div className="flex min-w-0 flex-col gap-2" aria-busy={streaming}>
      {text === "" ? (
        <Thinking />
      ) : (
        <CardText text={text} interactive className={cn(REPLY_TEXT, streaming && STREAM_CARET)} />
      )}
      {entry.status === "cut-off" && <CutOff session={session} retry={latest} />}
    </div>
  );
}

/** Before the first word: three dots. */
function Thinking() {
  return (
    <p role="status" aria-label="Answering" className="flex h-6 items-center gap-1">
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          aria-hidden
          style={{ animationDelay: `${delay}ms` }}
          className="size-1.5 animate-pulse rounded-full bg-muted-foreground motion-reduce:animate-none"
        />
      ))}
    </p>
  );
}

/** The User's Model's display name, for a failure that names it. */
export function useModelName(): string {
  const id = useQuery(settingsQueryOptions()).data?.settings.model;
  return MODELS.find((model) => model.id === id)?.name ?? "your Model";
}

/**
 * A reply that failed before its first word, at its place, with Open Settings,
 * Try again (with `retry`) or neither.
 */
function ReplyFailed({
  session,
  failure,
  retry,
}: {
  session: StudySession;
  failure: ChatFailure;
  retry: boolean;
}) {
  const model = useModelName();
  const action = CHAT_FAILURE_ACTIONS[failure];
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-destructive/30 px-3.5 py-2.5"
    >
      <p className="flex flex-1 items-start gap-2 text-sm leading-relaxed text-destructive">
        <AlertCircle aria-hidden className="mt-[0.2em] size-4 shrink-0" />
        {chatFailureMessage(failure, model)}
      </p>
      {action === "settings" && (
        <Button
          variant="outline"
          className={cn(
            PILL,
            "h-11 border-destructive/40 text-destructive no-underline lg:h-8 lg:px-3",
          )}
          render={<Link to="/settings" />}
          nativeButton={false}
        >
          Open Settings
        </Button>
      )}
      {action === "retry" && retry && (
        <Button
          variant="outline"
          className={cn(PILL, "h-11 border-destructive/40 text-destructive lg:h-8 lg:px-3")}
          onClick={() => session.retryReply()}
        >
          Try again
        </Button>
      )}
    </div>
  );
}

/** Under a reply that broke after some text: it is cut off, with Try again (with `retry`). */
function CutOff({ session, retry }: { session: StudySession; retry: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-dashed border-destructive/40 pt-2">
      <p className="flex flex-1 items-center gap-1.5 text-xs font-medium text-destructive">
        <Scissors aria-hidden className="size-3.5" />
        Cut off: the answer stopped here
      </p>
      {retry && (
        <Button
          variant="ghost"
          className="h-11 rounded-full px-3 text-sm text-destructive hover:text-destructive lg:h-8"
          onClick={() => session.retryReply()}
        >
          Try again
        </Button>
      )}
    </div>
  );
}

/** From the 20th message: a long chat costs more and drifts; rate and move on. */
function LongChatAdvice() {
  return (
    <p className="rounded-xl bg-primary/8 px-3.5 py-2.5 text-sm leading-relaxed text-foreground">
      <span className="font-medium">This chat is getting long.</span>{" "}
      <span className="text-muted-foreground">
        Each answer now costs more on your API key and keeps to the point less well. If you've got
        it, rate the card and move on.
      </span>
    </p>
  );
}

/**
 * The field: the study editor, with Send (Ctrl/⌘+Enter) and, while a reply
 * streams, Stop in its place; under it, what the keys do, or before the first
 * question, what the chat is.
 */
function Composer({
  session,
  state,
  asked,
}: {
  session: StudySession;
  state: StudyState;
  asked: boolean;
}) {
  const autoClose = useQuery(settingsQueryOptions()).data?.settings.autoClose ?? DEFAULT_AUTO_CLOSE;
  const label = useId();
  const { chat } = state;
  const tooLong = chat.draft.length > WRITTEN_ANSWER_MAX_LENGTH;
  return (
    <>
      <div
        data-chat-input
        className="flex items-end gap-2 rounded-xl bg-muted/60 py-1.5 pr-1.5 pl-3.5 focus-within:bg-background focus-within:ring-1 focus-within:ring-border"
      >
        <span id={label} className="sr-only">
          Your question
        </span>
        <LiveEditor
          value={chat.draft}
          onChange={(draft) => session.setChatDraft(draft)}
          placeholder={asked ? "Ask a follow-up…" : "Ask about this Feedback…"}
          labelledBy={label}
          autoClose={autoClose}
          toolbarLabel="Question formatting"
          onSubmit={() => session.ask()}
          className="max-h-48 min-h-11 flex-1 overflow-y-auto py-1.5 text-base leading-7"
        />
        {replying(chat) ? (
          <Button
            variant="outline"
            className="size-11 shrink-0 rounded-full lg:size-9"
            onClick={() => session.stopReply()}
            onMouseDown={(event) => event.preventDefault()}
            aria-label="Stop"
            title="Stop"
          >
            <Square aria-hidden className="size-3.5 fill-current" />
          </Button>
        ) : (
          <Button
            className="size-11 shrink-0 rounded-full lg:size-9"
            disabled={!state.askable}
            onClick={() => session.ask()}
            onMouseDown={(event) => event.preventDefault()}
            aria-label="Send"
            title={`Send (${SAVE_KEY}+Enter)`}
          >
            <ArrowUp aria-hidden className="size-4" />
          </Button>
        )}
      </div>
      {tooLong ? (
        <p role="alert" className="px-2 text-xs text-destructive">
          Keep it to {WRITTEN_ANSWER_MAX_LENGTH.toLocaleString("en-GB")} characters.
        </p>
      ) : (
        <p
          className={cn("px-2 text-xs text-muted-foreground", asked && "hidden pointer-fine:block")}
        >
          {asked ? (
            <>
              <kbd className="font-sans">{SAVE_KEY}</kbd>+<kbd className="font-sans">Enter</kbd>{" "}
              sends · Enter is a new line
            </>
          ) : (
            <>"Why is that wrong?" The Grader answers here, and never changes its suggestion.</>
          )}
        </p>
      )}
    </>
  );
}
