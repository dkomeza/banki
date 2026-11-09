import type { Rating } from "@banki/shared";
import {
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  Maximize2,
  MessageCircleQuestion,
  Minimize2,
  PanelRightClose,
  Sparkles,
} from "lucide-react";
import { type PointerEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { CardText } from "@/components/cards/card-text";
import { PILL } from "@/components/settings/parts";
import { Composer, ComposerHint, LongChatAdvice, Message } from "@/components/study/chat-parts";
import { type Chat, replying, requestedState, useChat } from "@/components/study/chat-proto";
import { Button } from "@/components/ui/button";
import { RATING_LABELS } from "@/lib/study";
import { cn } from "@/lib/utils";

// PROTOTYPE (BAN-42), Variant e, "Snap sheet": b's sheet, opened from "Ask
// about this" under the Feedback (a's place for it), in a few set sizes it
// snaps to rather than any size: low, half or tall below 1024 px (drag the
// grip and let go, or the size button in its header), narrow or wide from
// 1024 px (drag its left edge, or the widen button). Hide puts the sheet
// away altogether and gives the page back: the chat folds into the Feedback,
// where "Ask about this" was, as a small card with the latest reply's first
// lines and Show chat. A reply goes on streaming while it's hidden.

type Height = "low" | "half" | "tall";
type Width = "narrow" | "wide";
type Size = { height: Height; width: Width };

/** The sizes the User snapped the sheet to, kept across reloads. */
const SIZE_KEY = "banki.proto.chat-snap";
const readSize = (): Size => {
  try {
    const parsed: Partial<Size> | null = JSON.parse(localStorage.getItem(SIZE_KEY) ?? "{}");
    return { height: parsed?.height ?? "half", width: parsed?.width ?? "narrow" };
  } catch {
    return { height: "half", width: "narrow" };
  }
};
const writeSize = (size: Size) => {
  try {
    localStorage.setItem(SIZE_KEY, JSON.stringify(size));
  } catch {
    // Blocked storage: the size lasts for this page only.
  }
};

/** Each height below 1024 px, in px for snapping. */
const heightPx = (height: Height) => {
  const vh = window.innerHeight;
  const dock = Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue("--dock-h") || "124",
  );
  if (height === "low") return Math.min(272, vh * 0.45);
  if (height === "half") return Math.min(vh * 0.6, 512);
  return vh - dock - 72;
};
const HEIGHT_CLASS: Record<Height, string> = {
  low: "max-lg:h-[min(17rem,45dvh)]",
  half: "max-lg:h-[min(60dvh,32rem)]",
  tall: "max-lg:h-[calc(100dvh-var(--dock-h,7.75rem)-4.5rem-env(safe-area-inset-top))]",
};
/** The wide sheet: half the window, at most 48rem. */
const WIDE = "min(50vw, 48rem)";

/** The page's room for the open sheet from 1024 px; hidden, it gives it all back. */
export function sheetRoom(chat: Chat): string | false {
  return chat.open && "lg:pr-[var(--chat-w,27rem)] xl:pr-[var(--chat-w,30rem)]";
}

/** Under the Feedback: opens the chat; once hidden, the chat itself, folded. */
export function AskButton() {
  const [chat, actions, live] = useChat();
  if (!live) return null;
  if (chat.started && !chat.open) return <FoldedChat chat={chat} onShow={actions.open} />;
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
        {chat.open ? "Hide chat" : "Ask about this"}
      </Button>
      {!chat.open && <span className="text-xs text-muted-foreground">"Why is that wrong?"</span>}
    </div>
  );
}

/** The hidden chat, in the Feedback: how far it got, and the way back to it. */
function FoldedChat({ chat, onShow }: { chat: Chat; onShow: () => void }) {
  const count = chat.messages.length;
  const busy = replying(chat);
  const last = chat.messages.findLast((m) => m.role === "grader" && m.text !== "");
  return (
    <section
      aria-label="Follow-up chat, hidden"
      className="mt-1 flex flex-col gap-1 rounded-xl border border-dashed py-1.5 pr-1.5 pl-3.5"
    >
      <div className="flex items-center gap-2 text-sm">
        <MessageCircleQuestion aria-hidden className="size-4 shrink-0 text-primary" />
        <span className="font-medium">Ask the Grader</span>
        <span className="flex min-w-0 items-center gap-1.5 truncate text-xs text-muted-foreground">
          {busy && (
            <span
              aria-hidden
              className="size-1.5 animate-pulse rounded-full bg-primary motion-reduce:animate-none"
            />
          )}
          {busy ? "Replying…" : count === 0 ? "Nothing asked yet" : `${count} messages`}
        </span>
        <Button
          variant="outline"
          className={cn(PILL, "ml-auto h-11 shrink-0 border-border px-3.5 text-foreground lg:h-8")}
          onClick={onShow}
        >
          Show chat
        </Button>
      </div>
      {last !== undefined && (
        <CardText
          text={last.text.split("\n\n")[0] ?? ""}
          className="line-clamp-1 pr-2 pb-1 text-sm leading-relaxed text-muted-foreground"
        />
      )}
    </section>
  );
}

// Opened by a tap, or in `chat-empty`, the input takes the focus; the other states open unfocused.
const FOCUS_ON_OPEN = ["graded", "chat-empty", undefined].includes(requestedState());

/** The chat's sheet: over the page below 1024 px, beside it from there. */
export function ChatSheet({ suggested }: { suggested: Rating | undefined }) {
  const [chat, actions, live] = useChat();
  const [size, setSize] = useState<Size>(readSize);
  /** While the grip or the edge is dragged: the live size in px, before it snaps. */
  const [dragging, setDragging] = useState<{ height?: number; width?: number }>({});
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
  // The page's room follows the sheet's width.
  useEffect(() => {
    const root = document.documentElement;
    if (dragging.width !== undefined) root.style.setProperty("--chat-w", `${dragging.width}px`);
    else if (size.width === "wide") root.style.setProperty("--chat-w", WIDE);
    else root.style.removeProperty("--chat-w");
  }, [size.width, dragging.width]);
  useEffect(() => writeSize(size), [size]);
  if (!live || !chat.open) return null;
  const taller = size.height !== "tall";
  return (
    <section
      aria-label="Follow-up chat"
      style={
        dragging.height === undefined
          ? undefined
          : { ["--chat-h" as string]: `${dragging.height}px` }
      }
      className={cn(
        "fixed inset-x-0 z-20 flex flex-col overflow-hidden border bg-background shadow-[0_-12px_32px_-16px_oklch(0_0_0/0.35)]",
        // Below 1024 px: from the dock up, at the height it snapped to.
        "bottom-[calc(var(--dock-h,7.75rem)+0.5rem)] mx-2 max-h-[calc(100dvh-var(--dock-h,7.75rem)-4.5rem-env(safe-area-inset-top))] rounded-2xl sm:mx-auto sm:w-[min(40rem,calc(100%-3rem))]",
        dragging.height === undefined
          ? HEIGHT_CLASS[size.height]
          : "max-lg:h-[var(--chat-h)] max-lg:transition-none",
        "max-lg:transition-[height] max-lg:duration-200 motion-reduce:transition-none",
        // Its input focused, the dock steps aside: it sits on the formatting bar, over the keyboard.
        "max-lg:[body:has([data-chat-composer]:focus-within)_&]:bottom-[calc(var(--keyboard-inset,0px)+0.5rem)] max-sm:[body:has([data-chat-composer]:focus-within)_&]:bottom-[calc(max(var(--keyboard-inset,0px),3.9rem+env(safe-area-inset-bottom))+4.25rem)] max-lg:[body:has([data-chat-composer]:focus-within)_&]:max-h-[calc(100dvh-var(--keyboard-inset,0px)-9rem)]",
        // From 1024 px: the window's right edge, under the top bar, narrow or wide.
        "lg:top-[calc(3.5rem+env(safe-area-inset-top))] lg:right-0 lg:bottom-0 lg:left-auto lg:mx-0 lg:h-auto lg:max-h-none lg:w-[var(--chat-w,27rem)] lg:rounded-none lg:border-y-0 lg:border-r-0 lg:shadow-none xl:w-[var(--chat-w,30rem)]",
      )}
    >
      <HeightGrip
        height={size.height}
        onDrag={(height) => setDragging({ height })}
        onSnap={(height) => {
          setDragging({});
          setSize((s) => ({ ...s, height }));
        }}
      />
      <WidthEdge
        onDrag={(width) => setDragging({ width })}
        onSnap={(width) => {
          setDragging({});
          setSize((s) => ({ ...s, width }));
        }}
      />
      <header className="flex items-center gap-1 border-b pr-2 pb-1.5 pl-4 lg:py-2.5">
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
          className="size-11 rounded-full lg:hidden"
          aria-label={taller ? "Taller" : "Shorter"}
          title={taller ? "Taller" : "Shorter"}
          onClick={() => setSize((s) => ({ ...s, height: taller ? "tall" : "half" }))}
        >
          {taller ? (
            <Maximize2 aria-hidden className="size-4" />
          ) : (
            <Minimize2 aria-hidden className="size-4" />
          )}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="hidden size-9 rounded-full lg:inline-flex"
          aria-label={size.width === "wide" ? "Narrower" : "Wider"}
          title={size.width === "wide" ? "Narrower" : "Wider"}
          onClick={() => setSize((s) => ({ ...s, width: s.width === "wide" ? "narrow" : "wide" }))}
        >
          {size.width === "wide" ? (
            <ChevronsRight aria-hidden className="size-4" />
          ) : (
            <ChevronsLeft aria-hidden className="size-4" />
          )}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-11 rounded-full lg:size-9"
          aria-label="Hide chat"
          title="Hide chat (it waits under the Feedback)"
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

const HEIGHTS: Height[] = ["low", "half", "tall"];

/** Below 1024 px, the sheet's top edge: drag and let go to snap; a tap steps half ↔ tall. */
function HeightGrip({
  height,
  onDrag,
  onSnap,
}: {
  height: Height;
  onDrag: (px: number) => void;
  onSnap: (height: Height) => void;
}) {
  const from = useRef<{ y: number; start: number; last: number } | undefined>(undefined);
  const end = () => {
    const drag = from.current;
    from.current = undefined;
    if (drag === undefined) return;
    if (Math.abs(drag.last - drag.start) < 6) {
      onSnap(height === "half" ? "tall" : "half");
      return;
    }
    const nearest = HEIGHTS.reduce((best, h) =>
      Math.abs(heightPx(h) - drag.last) < Math.abs(heightPx(best) - drag.last) ? h : best,
    );
    onSnap(nearest);
  };
  return (
    <div
      role="slider"
      aria-label="Chat height"
      aria-orientation="vertical"
      aria-valuemin={0}
      aria-valuemax={2}
      aria-valuenow={HEIGHTS.indexOf(height)}
      aria-valuetext={height}
      tabIndex={0}
      onKeyDown={(event) => {
        const by = event.key === "ArrowUp" ? 1 : event.key === "ArrowDown" ? -1 : 0;
        if (by === 0) return;
        event.preventDefault();
        const i = Math.min(2, Math.max(0, HEIGHTS.indexOf(height) + by));
        onSnap(HEIGHTS[i] ?? height);
      }}
      onPointerDown={(event: PointerEvent<HTMLDivElement>) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        const start = event.currentTarget.parentElement?.offsetHeight ?? heightPx(height);
        from.current = { y: event.clientY, start, last: start };
      }}
      onPointerMove={(event) => {
        const drag = from.current;
        if (drag === undefined) return;
        drag.last = Math.max(200, Math.min(heightPx("tall"), drag.start + drag.y - event.clientY));
        if (Math.abs(drag.last - drag.start) >= 6) onDrag(drag.last);
      }}
      onPointerUp={end}
      onPointerCancel={end}
      className="flex h-6 shrink-0 cursor-row-resize touch-none items-center justify-center gap-1 outline-none focus-visible:bg-muted lg:hidden"
    >
      {HEIGHTS.map((h) => (
        <span
          key={h}
          aria-hidden
          className={cn(
            "h-1 rounded-full transition-colors",
            h === height ? "w-6 bg-primary/60" : "w-2 bg-border",
          )}
        />
      ))}
    </div>
  );
}

/** From 1024 px, the sheet's left edge: drag and let go to snap narrow or wide. */
function WidthEdge({
  onDrag,
  onSnap,
}: {
  onDrag: (px: number) => void;
  onSnap: (width: Width) => void;
}) {
  const from = useRef<{ x: number; start: number; last: number } | undefined>(undefined);
  const end = () => {
    const drag = from.current;
    from.current = undefined;
    if (drag === undefined) return;
    const narrow = window.innerWidth >= 1280 ? 480 : 432;
    const wide = Math.min(window.innerWidth / 2, 768);
    onSnap(drag.last > (narrow + wide) / 2 ? "wide" : "narrow");
  };
  return (
    <div
      aria-hidden
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        const start = event.currentTarget.parentElement?.offsetWidth ?? 432;
        from.current = { x: event.clientX, start, last: start };
      }}
      onPointerMove={(event) => {
        const drag = from.current;
        if (drag === undefined) return;
        drag.last = Math.max(352, Math.min(800, drag.start + drag.x - event.clientX));
        onDrag(drag.last);
      }}
      onPointerUp={end}
      onPointerCancel={end}
      title="Drag to snap wider or narrower"
      className="group absolute inset-y-0 left-0 z-10 hidden w-3 -translate-x-1.5 cursor-col-resize touch-none items-center justify-center lg:flex"
    >
      <span
        aria-hidden
        className="h-full w-px bg-transparent transition-colors group-hover:bg-primary/50 group-active:bg-primary"
      />
    </div>
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
