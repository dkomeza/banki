import { MessageCircleQuestion, MessagesSquare } from "lucide-react";
import { useEffect, useRef } from "react";
import { LABEL } from "@/components/study/answer";
import { Composer, Message } from "@/components/study/chat-parts";
import { LONG_CHAT, requestedState, useChat } from "@/components/study/chat-proto";
import { cn } from "@/lib/utils";

// PROTOTYPE (BAN-42), Variant c, "Ask line": the chat's input lives in the
// dock, a line above the ratings, so asking is always one tap away and the
// question is written where the thumb already is, like a messaging app. The
// thread itself goes on at the end of the page, under the Back (from 1024 px
// in the answer's column, the Feedback still in its margin), so a reply
// reads as the next part of the Card. While the input has the focus on a
// phone, the ratings fold away and leave the input over the keyboard; the
// long-chat advice is a quiet line in the dock, where the ratings are.

// Opened by a tap, or in `chat-empty`, the input takes the focus; the other states open unfocused.
const FOCUS_ON_OPEN = ["graded", "chat-empty", undefined].includes(requestedState());

/** In the dock, above the ratings: the line to ask on, then the study editor. */
export function DockAsk() {
  const [chat, actions, live] = useChat();
  // "/" from anywhere but a field opens the line, or goes back into it.
  useEffect(() => {
    if (!live) return () => {};
    const onKey = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey) return;
      if (target?.closest("input, textarea, select, [contenteditable]")) return;
      event.preventDefault();
      actions.open();
      requestAnimationFrame(() =>
        document.querySelector<HTMLElement>("[data-chat-composer] .cm-content")?.focus(),
      );
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [live, actions]);
  if (!live) return null;
  const long = chat.messages.length >= LONG_CHAT;
  return (
    <div className="flex flex-col gap-1.5">
      {long && (
        <p className="flex items-start gap-2 px-1 text-xs leading-relaxed text-muted-foreground">
          <MessagesSquare aria-hidden className="mt-0.5 size-3.5 shrink-0 text-primary" />
          <span>
            <span className="font-medium text-foreground">A long chat</span> costs more on your API
            key and keeps to the point less well. Got it? Rate and move on.
          </span>
        </p>
      )}
      {chat.open ? (
        <Composer
          chat={chat}
          actions={actions}
          autoFocus={FOCUS_ON_OPEN}
          placeholder="Ask the Grader about this card…"
          className="bg-background"
          editorClassName="max-h-32"
        />
      ) : (
        <button
          type="button"
          onClick={actions.open}
          className="flex h-11 w-full items-center gap-2.5 rounded-2xl border border-dashed bg-background px-3.5 text-left text-sm text-muted-foreground transition-colors hover:border-solid hover:bg-muted lg:h-10"
        >
          <MessageCircleQuestion aria-hidden className="size-4 shrink-0 text-primary" />
          <span className="flex-1 truncate">Ask about this card… "why is that wrong?"</span>
          <kbd className="hidden rounded border px-1.5 font-sans text-[0.65rem] pointer-fine:inline">
            /
          </kbd>
        </button>
      )}
    </div>
  );
}

/** At the end of the Card: the thread, under the Back. */
export function ThreadBelow() {
  const [chat, actions, live] = useChat();
  const end = useRef<HTMLDivElement>(null);
  const count = chat.messages.length;
  // A message sent scrolls the thread's end into view, over the dock.
  const seen = useRef(count);
  useEffect(() => {
    if (count > seen.current) end.current?.scrollIntoView({ block: "end", behavior: "smooth" });
    seen.current = count;
  }, [count]);
  if (!live || count === 0) return null;
  return (
    <section
      aria-label="Follow-up chat"
      className="flex min-w-0 flex-col gap-4 border-t pt-6 lg:col-start-1 lg:row-start-3"
    >
      <h2 className={cn(LABEL, "flex items-center gap-2")}>
        <MessagesSquare aria-hidden className="size-3.5 text-primary" />
        Your questions
      </h2>
      {chat.messages.map((message) => (
        <Message key={message.id} message={message} actions={actions} />
      ))}
      <div ref={end} className="scroll-mb-48" />
    </section>
  );
}
