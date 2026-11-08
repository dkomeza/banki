import type { Rating } from "@banki/shared";
import { ChevronDown, MessageCircleQuestion, Sparkles, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef } from "react";
import { Composer, ComposerHint, LongChatAdvice, Message } from "@/components/study/chat-parts";
import { requestedState, useChat } from "@/components/study/chat-proto";
import { Button } from "@/components/ui/button";
import { RATING_LABELS } from "@/lib/study";
import { cn } from "@/lib/utils";

// PROTOTYPE (BAN-42), Variant b, "Sheet": the chat is a sheet of its own
// that comes over the page, offered in the dock beside the ratings ("Ask
// about it"), so the Card's screen stays as BAN-40 left it until the User
// asks. Below 1024 px it rises from the dock, which stays under it with the
// ratings in reach; while its input has the focus, the dock steps aside and
// the sheet sits on the formatting bar, above the keyboard. From 1024 px it is
// a side sheet at the window's right edge, and the Card and the dock make
// room beside it, so the Feedback and the question are both in view.

/** Whether the sheet is open on a wide screen: the page makes room for it. */
export const SHEET_ROOM = "lg:pr-[27rem] xl:pr-[30rem]";

/** In the dock, before the ratings: opens the chat. */
export function AskButton() {
  const [chat, actions, live] = useChat();
  if (!live) return null;
  return (
    <Button
      variant="outline"
      aria-expanded={chat.open}
      onClick={chat.open ? actions.close : actions.open}
      onMouseDown={(event) => event.preventDefault()}
      className={cn(
        "h-11 shrink-0 gap-2 rounded-full border-border px-4 text-sm text-foreground lg:h-8 lg:px-3",
        chat.open && "border-primary/40 bg-primary/10 text-primary hover:bg-primary/15",
      )}
    >
      <MessageCircleQuestion aria-hidden className={cn("size-4", !chat.open && "text-primary")} />
      {chat.open ? "Hide chat" : "Ask about it"}
      {chat.messages.length > 0 && !chat.open && (
        <span className="rounded-full bg-muted px-1.5 text-xs tabular-nums text-muted-foreground">
          {chat.messages.length}
        </span>
      )}
    </Button>
  );
}

// Opened by a tap, or in `chat-empty`, the input takes the focus; the other states open unfocused.
const FOCUS_ON_OPEN = ["graded", "chat-empty", undefined].includes(requestedState());

/** The chat's sheet: over the page below 1024 px, beside it from there. */
export function ChatSheet({ suggested }: { suggested: Rating | undefined }) {
  const [chat, actions, live] = useChat();
  const body = useRef<HTMLDivElement>(null);
  // Keeps the newest words in view as they come (each render), unless the User scrolled up to read.
  const pinned = useRef(true);
  useLayoutEffect(() => {
    const el = body.current;
    if (el !== null && pinned.current) el.scrollTop = el.scrollHeight;
  });
  useEffect(() => {
    if (!chat.open) pinned.current = true;
  }, [chat.open]);
  if (!live || !chat.open) return null;
  return (
    <section
      aria-label="Follow-up chat"
      className={cn(
        "fixed inset-x-0 z-20 flex flex-col overflow-hidden border bg-background shadow-[0_-12px_32px_-16px_oklch(0_0_0/0.35)]",
        // Below 1024 px: from the dock up, at most most of the screen.
        "bottom-[calc(9.75rem+env(safe-area-inset-bottom))] mx-2 max-h-[min(70dvh,calc(100dvh-12.5rem))] min-h-72 rounded-2xl sm:mx-auto sm:w-[min(40rem,calc(100%-3rem))]",
        // Its input focused, the dock steps aside: it sits on the formatting bar, over the keyboard.
        "max-lg:[body:has([data-chat-composer]:focus-within)_&]:bottom-[calc(var(--keyboard-inset,0px)+0.5rem)] max-sm:[body:has([data-chat-composer]:focus-within)_&]:bottom-[calc(max(var(--keyboard-inset,0px),3.9rem+env(safe-area-inset-bottom))+4.25rem)]",
        // From 1024 px: the window's right edge, under the top bar.
        "lg:top-[calc(3.5rem+env(safe-area-inset-top))] lg:right-0 lg:bottom-0 lg:left-auto lg:mx-0 lg:max-h-none lg:w-[27rem] lg:rounded-none lg:border-y-0 lg:border-r-0 lg:shadow-none xl:w-[30rem]",
      )}
    >
      <header className="flex items-center gap-2 border-b px-4 py-1.5 lg:py-2.5">
        <div className="flex min-w-0 flex-1 flex-col">
          <h2 className="text-sm font-semibold">Ask the Grader</h2>
          {suggested !== undefined && (
            <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
              About this card · it still suggests
              <Sparkles aria-hidden className="size-3 text-primary" />
              <span className="font-medium text-primary">{RATING_LABELS[suggested]}</span>
            </p>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-11 rounded-full lg:size-9"
          aria-label="Hide chat"
          title="Hide chat"
          onClick={actions.close}
        >
          <ChevronDown aria-hidden className="size-5 lg:hidden" />
          <X aria-hidden className="hidden size-4 lg:block" />
        </Button>
      </header>
      <div
        ref={body}
        onScroll={(event) => {
          const el = event.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
        }}
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-4 py-4"
      >
        {chat.messages.length === 0 && (
          <div className="flex flex-col gap-3 pt-2">
            <p className="text-sm leading-relaxed text-muted-foreground">
              Ask about this card and your answer: why a step is wrong, or how to get it right. The
              chat never changes the suggestion; rating the card ends it.
            </p>
            <ul className="flex flex-wrap gap-2">
              {["Why is that wrong?", "Show me the right step"].map((q) => (
                <li key={q}>
                  <button
                    type="button"
                    onClick={() => actions.setDraft(q)}
                    className="h-11 rounded-full border border-dashed px-3.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground lg:h-8"
                  >
                    {q}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {chat.messages.map((message) => (
          <Message key={message.id} message={message} actions={actions} />
        ))}
        <LongChatAdvice chat={chat} />
      </div>
      <div className="flex flex-col gap-1.5 border-t bg-background px-3 pt-2.5 pb-3">
        <Composer chat={chat} actions={actions} autoFocus={FOCUS_ON_OPEN} />
        <ComposerHint className="px-1" />
      </div>
    </section>
  );
}

/** Below the sheet on a narrow screen: a thin shade over the Card, which a tap puts away. */
export function SheetShade() {
  const [chat, actions, live] = useChat();
  if (!live || !chat.open) return null;
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label="Hide chat"
      onClick={actions.close}
      className="fixed inset-x-0 top-[calc(3.5rem+env(safe-area-inset-top))] bottom-[calc(9.75rem+env(safe-area-inset-bottom))] z-[19] bg-background/50 lg:hidden"
    />
  );
}
