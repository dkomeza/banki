import type { GradeResponse } from "@banki/shared";
import { type ReactNode, useEffect, useRef } from "react";
import { CardText } from "@/components/cards/card-text";
import { Composer, LongChatAdvice, Message } from "@/components/study/chat-parts";
import { requestedState, useChat } from "@/components/study/chat-proto";
import { cn } from "@/lib/utils";

// PROTOTYPE (BAN-42), Variant i, "Feedback thread": there is no chat to open.
// The Feedback is the Grader's first message, and the reply field sits at the
// foot of the Feedback card from the moment the grade is in. Questions and
// replies go on inside that same card, under the Feedback, so the chat is the
// Feedback talking back. From 1024 px the card stays in its sticky margin
// (a little wider), and the thread scrolls inside it with the field pinned at
// its foot. Below 1024 px the card sits between your answer and the Back as
// before, and grows with the thread.

// Only `chat-empty` opens with the field focused; on a plain load it waits for a tap.
const FOCUS_ON_OPEN = requestedState() === "chat-empty";

/** The Feedback card, with the chat going on under the Feedback. */
export function FeedbackThread({
  result,
  suggests,
}: {
  result: GradeResponse;
  /** "Suggests Hard", as the Feedback shows it. */
  suggests: ReactNode;
}) {
  const [chat, actions] = useChat();
  const scroller = useRef<HTMLDivElement>(null);
  const count = chat.messages.length;
  // From 1024 px the thread scrolls in the card: it keeps to its newest words
  // as they come (Formulas typeset late), unless the User has scrolled up.
  useEffect(() => {
    const el = scroller.current;
    if (el === null || typeof ResizeObserver === "undefined") return () => {};
    let atEnd = true;
    const onScroll = () => {
      atEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    };
    const follow = () => {
      if (atEnd) el.scrollTop = el.scrollHeight;
    };
    const observer = new ResizeObserver(follow);
    for (const child of el.children) observer.observe(child);
    const added = new MutationObserver(() => {
      for (const child of el.children) observer.observe(child);
      follow();
    });
    added.observe(el, { childList: true });
    el.addEventListener("scroll", onScroll, { passive: true });
    follow();
    return () => {
      observer.disconnect();
      added.disconnect();
      el.removeEventListener("scroll", onScroll);
    };
  }, []);
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
        {count > 0 && (
          <div className="flex flex-col gap-4 border-t border-dashed pt-4">
            {chat.messages.map((message) => (
              <Message key={message.id} message={message} actions={actions} />
            ))}
          </div>
        )}
        <LongChatAdvice chat={chat} />
      </div>
      <div className="flex flex-col gap-1.5 border-t p-2">
        <Composer
          chat={chat}
          actions={actions}
          autoFocus={FOCUS_ON_OPEN}
          placeholder={count === 0 ? "Ask about this Feedback…" : "Ask a follow-up…"}
          className="rounded-xl border-0 bg-muted/60 focus-within:bg-background focus-within:ring-1 focus-within:ring-border"
        />
        <p
          className={cn(
            "px-2 text-xs text-muted-foreground",
            count > 0 && "hidden pointer-fine:block",
          )}
        >
          {count === 0 ? (
            <>"Why is that wrong?" The Grader answers here, and never changes its suggestion.</>
          ) : (
            <>
              <kbd className="font-sans">Ctrl</kbd>+<kbd className="font-sans">Enter</kbd> sends ·
              Enter is a new line
            </>
          )}
        </p>
      </div>
    </section>
  );
}
