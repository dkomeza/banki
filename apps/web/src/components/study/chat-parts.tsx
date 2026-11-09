import { DEFAULT_AUTO_CLOSE } from "@banki/shared";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, ArrowUp, Scissors, Square } from "lucide-react";
import { useId } from "react";
import { CardText } from "@/components/cards/card-text";
import { LiveEditor } from "@/components/editor/live-editor";
import { PILL } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import {
  type Chat,
  type ChatActions,
  type ChatMessage,
  LONG_CHAT,
  REPLY_FAILED,
  replying,
} from "@/components/study/chat-proto";
import { settingsQueryOptions } from "@/lib/settings";
import { cn } from "@/lib/utils";

// PROTOTYPE (BAN-42): the Follow-up chat's pieces, which each Variant lays
// out its own way: a message, a reply's failure, the long-chat advice, and
// the composer (the study editor, with Send and Stop).

/** A reply's Markdown, with LaTeX in the Deck's Macros. */
export const REPLY_TEXT =
  "text-[0.95rem] leading-relaxed [&_ol]:flex [&_ol]:flex-col [&_ol]:gap-1.5 [&_p+p]:mt-2";

/** One message: the User's in a quiet bubble, the Grader's as plain text. */
export function Message({
  message,
  actions,
  className,
}: {
  message: ChatMessage;
  actions: ChatActions;
  className?: string;
}) {
  if (message.role === "user") {
    return (
      <div className={cn("flex justify-end", className)}>
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-muted px-3.5 py-2.5">
          <CardText text={message.text} className="text-[0.95rem] leading-relaxed" />
        </div>
      </div>
    );
  }
  if (message.status === "failed") return <ReplyFailed actions={actions} className={className} />;
  return (
    <div
      className={cn("flex flex-col gap-2", className)}
      aria-busy={message.status === "streaming"}
    >
      {message.text === "" ? (
        <Thinking />
      ) : (
        <CardText
          text={message.text}
          interactive
          className={cn(REPLY_TEXT, message.status === "streaming" && STREAM_CARET)}
        />
      )}
      {message.status === "cut-off" && <CutOff actions={actions} />}
    </div>
  );
}

/** A blinking caret after the last word of a streaming reply. */
const STREAM_CARET =
  "[&>*:last-child]:after:ml-0.5 [&>*:last-child]:after:inline-block [&>*:last-child]:after:h-[1em] [&>*:last-child]:after:w-[0.45em] [&>*:last-child]:after:translate-y-[0.15em] [&>*:last-child]:after:animate-pulse [&>*:last-child]:after:rounded-[1px] [&>*:last-child]:after:bg-primary [&>*:last-child]:after:content-[''] motion-reduce:[&>*:last-child]:after:animate-none";

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

/** A reply that failed before its first word, at its place, with Try again. */
export function ReplyFailed({ actions, className }: { actions: ChatActions; className?: string }) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-destructive/30 px-3.5 py-2.5",
        className,
      )}
    >
      <p className="flex flex-1 items-center gap-2 text-sm text-destructive">
        <AlertCircle aria-hidden className="size-4 shrink-0" />
        {REPLY_FAILED}
      </p>
      <Button
        variant="outline"
        className={cn(PILL, "h-11 border-destructive/40 text-destructive lg:h-8 lg:px-3")}
        onClick={actions.retry}
      >
        Try again
      </Button>
    </div>
  );
}

/** Under a reply that broke after some text. */
function CutOff({ actions }: { actions: ChatActions }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-dashed border-destructive/40 pt-2">
      <p className="flex flex-1 items-center gap-1.5 text-xs font-medium text-destructive">
        <Scissors aria-hidden className="size-3.5" />
        Cut off: the answer stopped here
      </p>
      <Button
        variant="ghost"
        className="h-11 rounded-full px-3 text-sm text-destructive hover:text-destructive lg:h-8"
        onClick={actions.retry}
      >
        Try again
      </Button>
    </div>
  );
}

/** From the 20th message: a long chat costs more and drifts; rate and move on. */
export function LongChatAdvice({ chat, className }: { chat: Chat; className?: string }) {
  if (chat.messages.length < LONG_CHAT) return null;
  return (
    <p
      className={cn(
        "rounded-xl bg-primary/8 px-3.5 py-2.5 text-sm leading-relaxed text-foreground",
        className,
      )}
    >
      <span className="font-medium">This chat is getting long.</span>{" "}
      <span className="text-muted-foreground">
        Each answer now costs more on your API key and keeps to the point less well. If you've got
        it, rate the card and move on.
      </span>
    </p>
  );
}

/**
 * The input: the study editor, with Send (Ctrl/⌘+Enter) and, while a reply
 * streams, Stop in its place.
 */
export function Composer({
  chat,
  actions,
  autoFocus = false,
  placeholder = "Ask about this card…",
  className,
  editorClassName,
}: {
  chat: Chat;
  actions: ChatActions;
  autoFocus?: boolean;
  placeholder?: string;
  className?: string;
  editorClassName?: string;
}) {
  const autoClose = useQuery(settingsQueryOptions()).data?.settings.autoClose ?? DEFAULT_AUTO_CLOSE;
  const label = useId();
  const busy = replying(chat);
  return (
    <div
      data-chat-composer
      className={cn(
        "flex items-end gap-2 rounded-2xl border bg-card py-1.5 pr-1.5 pl-3.5",
        className,
      )}
    >
      <span id={label} className="sr-only">
        Your question
      </span>
      <LiveEditor
        value={chat.draft}
        onChange={actions.setDraft}
        placeholder={placeholder}
        labelledBy={label}
        autoFocus={autoFocus}
        autoClose={autoClose}
        toolbarLabel="Question formatting"
        onSubmit={actions.send}
        className={cn(
          "max-h-48 min-h-11 flex-1 overflow-y-auto py-1.5 text-base leading-7",
          editorClassName,
        )}
      />
      {busy ? (
        <Button
          variant="outline"
          className="size-11 shrink-0 rounded-full lg:size-9"
          onClick={actions.stop}
          aria-label="Stop"
          title="Stop"
        >
          <Square aria-hidden className="size-3.5 fill-current" />
        </Button>
      ) : (
        <Button
          className="size-11 shrink-0 rounded-full lg:size-9"
          disabled={chat.draft.trim() === ""}
          onClick={actions.send}
          onMouseDown={(event) => event.preventDefault()}
          aria-label="Send"
          title="Send (Ctrl+Enter)"
        >
          <ArrowUp aria-hidden className="size-4" />
        </Button>
      )}
    </div>
  );
}

/** Under the composer on a fine pointer: what the keys do. */
export function ComposerHint({ className }: { className?: string }) {
  return (
    <p className={cn("hidden text-xs text-muted-foreground pointer-fine:block", className)}>
      <kbd className="font-sans">Ctrl</kbd>+<kbd className="font-sans">Enter</kbd> sends · Enter is
      a new line · it never changes the suggestion
    </p>
  );
}
