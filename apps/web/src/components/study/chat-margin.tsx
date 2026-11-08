import { MessageCircleQuestion } from "lucide-react";
import { useEffect, useRef } from "react";
import { PILL } from "@/components/settings/parts";
import { LABEL } from "@/components/study/answer";
import { Composer, ComposerHint, LongChatAdvice, Message } from "@/components/study/chat-parts";
import { requestedState, useChat } from "@/components/study/chat-proto";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// PROTOTYPE (BAN-42), Variant a, "Margin thread": the chat goes on under the
// Feedback, in the same margin. From 1024 px the margin widens a little once
// the chat is open and runs down the page, and the input stays pinned just
// above the dock, so the question sits beside the answer it is about.
// Below 1024 px the thread follows the Feedback in the page, before the
// Back; while the input has the focus, the dock steps aside for the keyboard.

// Opened by a tap, or in `chat-empty`, the input takes the focus; the other states open unfocused.
const FOCUS_ON_OPEN = ["graded", "chat-empty", undefined].includes(requestedState());

/** Under the Feedback: Ask about this, then the thread and its input. */
export function MarginChat() {
  const [chat, actions, live] = useChat();
  const end = useRef<HTMLDivElement>(null);
  const count = chat.messages.length;
  // A message sent brings the input back into view; the states open as they are.
  const seen = useRef(count);
  useEffect(() => {
    if (count > seen.current) end.current?.scrollIntoView({ block: "nearest" });
    seen.current = count;
  }, [count]);
  if (!live) return null;
  if (!chat.open) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1">
        <Button
          variant="outline"
          className={cn(PILL, "h-11 gap-2 border-border px-4 text-foreground lg:h-9")}
          onClick={actions.open}
        >
          <MessageCircleQuestion aria-hidden className="size-4 text-primary" />
          Ask about this
        </Button>
        <span className="text-xs text-muted-foreground">"Why is that wrong?"</span>
      </div>
    );
  }
  return (
    <section aria-label="Follow-up chat" className="flex flex-col gap-3 pt-3">
      <h2 className={cn(LABEL, "flex items-center gap-2")}>
        <MessageCircleQuestion aria-hidden className="size-3.5 text-primary" />
        Ask the Grader
      </h2>
      {count === 0 && (
        <p className="text-sm leading-relaxed text-muted-foreground">
          Ask about this card: why a step is wrong, or how to get it right. It won't change the
          suggestion.
        </p>
      )}
      <div className="flex flex-col gap-4">
        {chat.messages.map((message) => (
          <Message key={message.id} message={message} actions={actions} />
        ))}
      </div>
      <LongChatAdvice chat={chat} />
      <div
        ref={end}
        className="flex scroll-mb-40 flex-col gap-1.5 bg-background/95 pt-1 pb-1 backdrop-blur lg:sticky lg:bottom-[7.75rem] lg:-mx-1 lg:px-1 lg:pb-3"
      >
        <Composer chat={chat} actions={actions} autoFocus={FOCUS_ON_OPEN} />
        <ComposerHint className="px-1" />
      </div>
    </section>
  );
}
