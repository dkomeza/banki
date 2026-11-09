import type { Rating } from "@banki/shared";
import {
  ChevronDown,
  ChevronUp,
  MessageCircleQuestion,
  PanelRightClose,
  PanelRightOpen,
  Sparkles,
} from "lucide-react";
import {
  type KeyboardEvent,
  type PointerEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { PILL } from "@/components/settings/parts";
import { Composer, ComposerHint, LongChatAdvice, Message } from "@/components/study/chat-parts";
import { type Chat, replying, requestedState, useChat } from "@/components/study/chat-proto";
import { Button } from "@/components/ui/button";
import { RATING_LABELS } from "@/lib/study";
import { cn } from "@/lib/utils";

// PROTOTYPE (BAN-42), Variant d, "Grip sheet": b's sheet, opened from "Ask
// about this" under the Feedback (a's place for it). The sheet takes any size
// the User drags it to: by the grip on its top edge below 1024 px, by its
// left edge from there; a double click (or tap) on the grip jumps between
// its default size and its largest. Hide folds it into a bar that stays on
// screen with the chat in it: above the dock below 1024 px, a rail at the
// window's right edge from there. A reply goes on streaming while it's hidden.

/** The sizes the User dragged the sheet to, kept across reloads. */
const SIZE_KEY = "banki.proto.chat-size";
type Size = { height?: number; width?: number };
const readSize = (): Size => {
  try {
    const parsed: Size | null = JSON.parse(localStorage.getItem(SIZE_KEY) ?? "{}");
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
};
const writeSize = (size: Size) => {
  try {
    localStorage.setItem(SIZE_KEY, JSON.stringify(size));
  } catch {
    // Blocked storage: the size lasts for this page only.
  }
};

const MIN_HEIGHT = 240;
const MIN_WIDTH = 352;
/** Leaves the top bar and a strip of the Card above the sheet. */
const maxHeight = () => {
  const dock = Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue("--dock-h") || "124",
  );
  return Math.max(MIN_HEIGHT, window.innerHeight - dock - 56 - 24);
};
/** Leaves the Card's column at least ~28rem. */
const maxWidth = () => Math.max(MIN_WIDTH, Math.min(800, window.innerWidth - 448));

/** The page's room for the sheet from 1024 px: its width open, the rail's hidden. */
export function sheetRoom(chat: Chat): string | false {
  if (chat.open) return "lg:pr-[var(--chat-w,27rem)] xl:pr-[var(--chat-w,30rem)]";
  if (chat.started) return "lg:pr-14";
  return false;
}

/** Under the Feedback: opens the chat, or shows it again once hidden. */
export function AskButton() {
  const [chat, actions, live] = useChat();
  if (!live) return null;
  const count = chat.messages.length;
  if (!chat.started) {
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
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1">
      <Button
        variant="outline"
        aria-expanded={chat.open}
        onClick={chat.open ? actions.close : actions.open}
        className={cn(
          PILL,
          "h-11 gap-2 border-border px-4 text-foreground lg:h-9",
          chat.open && "border-primary/40 bg-primary/10 text-primary hover:bg-primary/15",
        )}
      >
        <MessageCircleQuestion aria-hidden className={cn("size-4", !chat.open && "text-primary")} />
        {chat.open ? "Hide chat" : "Show chat"}
        {count > 0 && (
          <span className="rounded-full bg-muted px-1.5 text-xs tabular-nums text-muted-foreground">
            {count}
          </span>
        )}
      </Button>
    </div>
  );
}

// Opened by a tap, or in `chat-empty`, the input takes the focus; the other states open unfocused.
const FOCUS_ON_OPEN = ["graded", "chat-empty", undefined].includes(requestedState());

/** The chat's sheet: over the page below 1024 px, beside it from there; or its bar, hidden. */
export function ChatSheet({ suggested }: { suggested: Rating | undefined }) {
  const [chat, actions, live] = useChat();
  const [size, setSize] = useState<Size>(readSize);
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
  // The page's room follows the width dragged to.
  useEffect(() => {
    const root = document.documentElement;
    if (size.width === undefined) root.style.removeProperty("--chat-w");
    else root.style.setProperty("--chat-w", `${size.width}px`);
    writeSize(size);
  }, [size]);
  if (!live || !chat.started) return null;
  if (!chat.open) return <HiddenBar chat={chat} onShow={actions.open} />;
  return (
    <section
      aria-label="Follow-up chat"
      style={size.height === undefined ? undefined : { ["--chat-h" as string]: `${size.height}px` }}
      className={cn(
        "fixed inset-x-0 z-20 flex flex-col overflow-hidden border bg-background shadow-[0_-12px_32px_-16px_oklch(0_0_0/0.35)]",
        // Below 1024 px: from the dock up, as tall as dragged to.
        "bottom-[calc(var(--dock-h,7.75rem)+0.5rem)] mx-2 max-h-[calc(100dvh-var(--dock-h,7.75rem)-4.5rem-env(safe-area-inset-top))] min-h-60 rounded-2xl sm:mx-auto sm:w-[min(40rem,calc(100%-3rem))]",
        size.height === undefined ? "max-lg:h-[min(60dvh,32rem)]" : "max-lg:h-[var(--chat-h)]",
        // Its input focused, the dock steps aside: it sits on the formatting bar, over the keyboard.
        "max-lg:[body:has([data-chat-composer]:focus-within)_&]:bottom-[calc(var(--keyboard-inset,0px)+0.5rem)] max-sm:[body:has([data-chat-composer]:focus-within)_&]:bottom-[calc(max(var(--keyboard-inset,0px),3.9rem+env(safe-area-inset-bottom))+4.25rem)] max-lg:[body:has([data-chat-composer]:focus-within)_&]:max-h-[calc(100dvh-var(--keyboard-inset,0px)-9rem)]",
        // From 1024 px: the window's right edge, under the top bar, as wide as dragged to.
        "lg:top-[calc(3.5rem+env(safe-area-inset-top))] lg:right-0 lg:bottom-0 lg:left-auto lg:mx-0 lg:h-auto lg:max-h-none lg:w-[var(--chat-w,27rem)] lg:rounded-none lg:border-y-0 lg:border-r-0 lg:shadow-none xl:w-[var(--chat-w,30rem)]",
      )}
    >
      <HeightGrip setSize={setSize} />
      <WidthGrip setSize={setSize} />
      <header className="flex items-center gap-2 border-b px-4 pb-1.5 lg:py-2.5">
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
          title="Hide chat (it keeps the chat)"
          onClick={actions.close}
        >
          <ChevronDown aria-hidden className="size-5 lg:hidden" />
          <PanelRightClose aria-hidden className="hidden size-4 lg:block" />
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

type GripProps = {
  setSize: (change: (size: Size) => Size) => void;
};

/** Drags `start` by the pointer's travel along one axis, clamped. */
function useDrag(onMove: (delta: number, start: number) => void, axis: "x" | "y") {
  const from = useRef<{ at: number; start: number } | undefined>(undefined);
  return {
    begin: (event: PointerEvent<HTMLElement>, start: number) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      from.current = {
        at: axis === "x" ? event.clientX : event.clientY,
        start,
      };
    },
    move: (event: PointerEvent<HTMLElement>) => {
      if (from.current === undefined) return;
      const at = axis === "x" ? event.clientX : event.clientY;
      onMove(from.current.at - at, from.current.start);
    },
    end: () => {
      from.current = undefined;
    },
  };
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/** Below 1024 px, the sheet's top edge: drag it up or down; a tap jumps to its largest and back. */
function HeightGrip({ setSize }: GripProps) {
  const ref = useRef<HTMLDivElement>(null);
  const moved = useRef(false);
  const current = () => ref.current?.parentElement?.offsetHeight ?? MIN_HEIGHT;
  const drag = useDrag((delta, start) => {
    if (Math.abs(delta) > 4) moved.current = true;
    const height = clamp(start + delta, MIN_HEIGHT, maxHeight());
    setSize((s) => ({ ...s, height }));
  }, "y");
  const toggle = () =>
    setSize((s) =>
      s.height !== undefined && s.height >= maxHeight() - 8
        ? { ...s, height: undefined }
        : { ...s, height: maxHeight() },
    );
  const onKeyDown = (event: KeyboardEvent) => {
    const step = event.key === "ArrowUp" ? 32 : event.key === "ArrowDown" ? -32 : 0;
    if (step === 0) return;
    event.preventDefault();
    setSize((s) => ({
      ...s,
      height: clamp(current() + step, MIN_HEIGHT, maxHeight()),
    }));
  };
  return (
    <div
      ref={ref}
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize the chat"
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDown={(event) => {
        moved.current = false;
        drag.begin(event, current());
      }}
      onPointerMove={drag.move}
      onPointerUp={() => {
        drag.end();
        if (!moved.current) toggle();
      }}
      onPointerCancel={drag.end}
      className="flex h-6 shrink-0 cursor-row-resize touch-none items-center justify-center outline-none focus-visible:bg-muted lg:hidden"
    >
      <span aria-hidden className="h-1 w-10 rounded-full bg-border" />
    </div>
  );
}

/** From 1024 px, the sheet's left edge: drag it to make the sheet wider or narrower. */
function WidthGrip({ setSize }: GripProps) {
  const ref = useRef<HTMLDivElement>(null);
  const current = () => ref.current?.parentElement?.offsetWidth ?? MIN_WIDTH;
  const drag = useDrag((delta, start) => {
    setSize((s) => ({
      ...s,
      width: clamp(start + delta, MIN_WIDTH, maxWidth()),
    }));
  }, "x");
  const onKeyDown = (event: KeyboardEvent) => {
    const step = event.key === "ArrowLeft" ? 32 : event.key === "ArrowRight" ? -32 : 0;
    if (step === 0) return;
    event.preventDefault();
    setSize((s) => ({
      ...s,
      width: clamp(current() + step, MIN_WIDTH, maxWidth()),
    }));
  };
  return (
    <div
      ref={ref}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the chat"
      title="Drag to resize · double-click for the default width"
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDown={(event) => drag.begin(event, current())}
      onPointerMove={drag.move}
      onPointerUp={drag.end}
      onPointerCancel={drag.end}
      onDoubleClick={() => setSize((s) => ({ ...s, width: undefined }))}
      className="group absolute inset-y-0 left-0 z-10 hidden w-3 -translate-x-1.5 cursor-col-resize touch-none items-center justify-center outline-none lg:flex"
    >
      <span
        aria-hidden
        className="h-full w-px bg-transparent transition-colors group-hover:bg-primary/50 group-focus-visible:bg-primary group-active:bg-primary"
      />
      <span
        aria-hidden
        className="absolute top-1/2 h-10 w-1.5 -translate-y-1/2 rounded-full border bg-background transition-colors group-hover:border-primary/50"
      />
    </div>
  );
}

/** The hidden sheet: a bar above the dock below 1024 px, a rail at the right edge from there. */
function HiddenBar({ chat, onShow }: { chat: Chat; onShow: () => void }) {
  const count = chat.messages.length;
  const busy = replying(chat);
  const status = busy ? "Replying…" : count === 0 ? "Nothing asked yet" : `${count} messages`;
  return (
    <>
      <button
        type="button"
        onClick={onShow}
        aria-label={`Show chat, ${status}`}
        className="fixed inset-x-0 bottom-[var(--dock-h,7.75rem)] z-20 mx-2 flex h-11 items-center gap-2 rounded-t-2xl border border-b-0 bg-background px-4 text-left text-sm shadow-[0_-8px_24px_-16px_oklch(0_0_0/0.35)] sm:mx-auto sm:w-[min(40rem,calc(100%-3rem))] lg:hidden"
      >
        <MessageCircleQuestion aria-hidden className="size-4 shrink-0 text-primary" />
        <span className="font-medium">Ask the Grader</span>
        <span className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
          {busy && (
            <span
              aria-hidden
              className="size-1.5 animate-pulse rounded-full bg-primary motion-reduce:animate-none"
            />
          )}
          {status}
        </span>
        <ChevronUp aria-hidden className="ml-auto size-4 text-muted-foreground" />
      </button>
      <button
        type="button"
        onClick={onShow}
        aria-label={`Show chat, ${status}`}
        title="Show chat"
        className="fixed top-[calc(3.5rem+env(safe-area-inset-top))] right-0 bottom-0 z-20 hidden w-14 flex-col items-center gap-3 border-l bg-background pt-4 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:flex"
      >
        <PanelRightOpen aria-hidden className="size-4" />
        <MessageCircleQuestion aria-hidden className="size-4 text-primary" />
        {count > 0 && (
          <span className="rounded-full bg-muted px-1.5 text-xs tabular-nums">{count}</span>
        )}
        {busy && (
          <span
            aria-hidden
            className="size-1.5 animate-pulse rounded-full bg-primary motion-reduce:animate-none"
          />
        )}
        <span className="text-xs font-medium [writing-mode:vertical-rl]">Ask the Grader</span>
      </button>
    </>
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
      className="fixed inset-x-0 top-[calc(3.5rem+env(safe-area-inset-top))] bottom-[var(--dock-h,7.75rem)] z-[19] bg-background/50 lg:hidden"
    />
  );
}
