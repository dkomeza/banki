import type { Rating } from "@banki/shared";
import {
  ChevronDown,
  ChevronUp,
  GripHorizontal,
  MessageCircleQuestion,
  Sparkles,
} from "lucide-react";
import {
  type KeyboardEvent,
  type PointerEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { PILL } from "@/components/settings/parts";
import { Composer, ComposerHint, LongChatAdvice, Message } from "@/components/study/chat-parts";
import { type Chat, replying, requestedState, useChat } from "@/components/study/chat-proto";
import { Button } from "@/components/ui/button";
import { RATING_LABELS } from "@/lib/study";
import { cn } from "@/lib/utils";

// PROTOTYPE (BAN-42), Variant g, "Free window": d's sheet as a window floating
// over the page, which the User puts where it covers least: the Card never
// moves for it. From 640 px it is a window: drag its title bar to move it
// anywhere between the top bar and the dock, and any edge or corner to resize
// it; a double click on the title bar puts it back at the bottom right.
// Hide folds it down into its title bar, at the window's bottom edge, with the
// count or "Replying…"; the bar moves too, and a tap unfolds it. Below 640 px
// it is d's sheet from the dock, floating, and hides into a pill.

/** Where the User put the window and how big, kept across reloads; none is the default. */
const RECT_KEY = "banki.proto.chat-window";
type Rect = { x: number; y: number; w: number; h: number };
/** `rect` from 640 px; `height`, the sheet's, below. */
type Place = { rect?: Rect; height?: number };
const readPlace = (): Place => {
  try {
    const parsed: Place | null = JSON.parse(localStorage.getItem(RECT_KEY) ?? "{}");
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
};
const writePlace = (place: Place) => {
  try {
    localStorage.setItem(RECT_KEY, JSON.stringify(place));
  } catch {
    // Blocked storage: the place lasts for this page only.
  }
};

const MIN_HEIGHT = 240;
const MIN_WIDTH = 320;
const GAP = 16;
const TOP_BAR = 56;
const dockHeight = () =>
  Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue("--dock-h") || "124",
  );
/** Below 640 px: leaves the top bar and a strip of the Card above the sheet. */
const maxHeight = () => Math.max(MIN_HEIGHT, window.innerHeight - dockHeight() - TOP_BAR - 24);

/** Where a window may go: under the top bar, above the dock. */
function bounds() {
  return {
    left: GAP,
    top: TOP_BAR + GAP,
    right: document.documentElement.clientWidth - GAP,
    bottom: window.innerHeight - dockHeight() - GAP,
  };
}

/** The window's place at first: the bottom right, over the Feedback margin. */
function defaultRect(): Rect {
  const b = bounds();
  const w = Math.min(window.innerWidth >= 1280 ? 448 : 416, b.right - b.left);
  const h = Math.max(MIN_HEIGHT, Math.min(560, b.bottom - b.top));
  return { x: b.right - w, y: b.bottom - h, w, h };
}

/** A rect kept inside the bounds, shrunk to fit when the window is smaller than it. */
function fit(r: Rect): Rect {
  const b = bounds();
  const w = Math.max(Math.min(MIN_WIDTH, b.right - b.left), Math.min(r.w, b.right - b.left));
  const h = Math.max(Math.min(MIN_HEIGHT, b.bottom - b.top), Math.min(r.h, b.bottom - b.top));
  const x = clamp(r.x, b.left, b.right - w);
  const y = clamp(r.y, b.top, Math.max(b.top, b.bottom - h));
  return { x, y, w, h };
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/** Re-renders when the page's width or the window's height changes, so the chat's window stays inside it. */
function useViewport() {
  return useSyncExternalStore(
    (notify) => {
      // A scrollbar coming or going changes the page's width without a resize.
      const observer = new ResizeObserver(notify);
      observer.observe(document.documentElement);
      window.addEventListener("resize", notify);
      return () => {
        observer.disconnect();
        window.removeEventListener("resize", notify);
      };
    },
    () => `${document.documentElement.clientWidth}x${window.innerHeight}`,
  );
}

const WIDE = "(min-width: 640px)";
function useWide() {
  return useSyncExternalStore(
    (notify) => {
      const query = matchMedia(WIDE);
      query.addEventListener("change", notify);
      return () => query.removeEventListener("change", notify);
    },
    () => matchMedia(WIDE).matches,
  );
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

/** The chat's window, floating over the page; rolled up into its title bar, hidden. */
export function ChatSheet({ suggested }: { suggested: Rating | undefined }) {
  const [chat, actions, live] = useChat();
  const [place, setPlace] = useState<Place>(readPlace);
  const wide = useWide();
  useViewport();
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
  useEffect(() => writePlace(place), [place]);
  if (!live || !chat.started) return null;
  if (!chat.open && !wide) return <HiddenPill chat={chat} onShow={actions.open} />;
  const rect = fit(place.rect ?? defaultRect());
  const setRect = (r: Rect | undefined) => setPlace((p) => ({ ...p, rect: r }));
  const rolled = !chat.open;
  const style: Record<string, string | number> = wide
    ? {
        left: rect.x,
        // Rolled up, the bar keeps the window's bottom edge, so it folds down toward the dock.
        ...(rolled
          ? { bottom: window.innerHeight - rect.y - rect.h, top: "auto" }
          : { top: rect.y, bottom: "auto" }),
        width: rect.w,
        right: "auto",
        margin: 0,
        height: rolled ? "auto" : rect.h,
        maxHeight: "none",
        minHeight: 0,
      }
    : place.height === undefined
      ? {}
      : { ["--chat-h"]: `${place.height}px` };
  const count = chat.messages.length;
  const busy = replying(chat);
  return (
    <section
      aria-label="Follow-up chat"
      style={style}
      className={cn(
        "fixed inset-x-0 z-20 flex flex-col overflow-hidden border bg-background shadow-[0_-12px_32px_-16px_oklch(0_0_0/0.35)]",
        // Below 640 px: from the dock up, as tall as dragged to.
        "bottom-[calc(var(--dock-h,7.75rem)+0.5rem)] mx-2 max-h-[calc(100dvh-var(--dock-h,7.75rem)-4.5rem-env(safe-area-inset-top))] min-h-60 rounded-2xl",
        place.height === undefined ? "max-sm:h-[min(60dvh,32rem)]" : "max-sm:h-[var(--chat-h)]",
        // Its input focused, the dock steps aside: it sits on the formatting bar, over the keyboard.
        "max-sm:[body:has([data-chat-composer]:focus-within)_&]:bottom-[calc(max(var(--keyboard-inset,0px),3.9rem+env(safe-area-inset-bottom))+4.25rem)] max-sm:[body:has([data-chat-composer]:focus-within)_&]:max-h-[calc(100dvh-var(--keyboard-inset,0px)-9rem)]",
        // From 640 px: a window where the User put it. Its grips reach past its edges, so it doesn't clip.
        "sm:overflow-visible sm:shadow-[0_24px_64px_-24px_oklch(0_0_0/0.45),0_2px_8px_-4px_oklch(0_0_0/0.2)]",
      )}
    >
      <HeightGrip setHeight={(height) => setPlace((p) => ({ ...p, height }))} />
      {!rolled &&
        EDGE_NAMES.map((edge) => <EdgeGrip key={edge} edge={edge} rect={rect} setRect={setRect} />)}
      <TitleBar rect={rect} setRect={setRect} onToggle={rolled ? actions.open : undefined}>
        <div className="flex min-w-0 flex-1 flex-col">
          <h2 className="text-sm font-semibold">Ask the Grader</h2>
          {rolled ? (
            <p className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
              {busy && (
                <span
                  aria-hidden
                  className="size-1.5 animate-pulse rounded-full bg-primary motion-reduce:animate-none"
                />
              )}
              {busy ? "Replying…" : `${count} messages · hidden`}
            </p>
          ) : (
            suggested !== undefined && (
              <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                About this card · it still suggests
                <Sparkles aria-hidden className="size-3 text-primary" />
                <span className="font-medium text-primary">{RATING_LABELS[suggested]}</span>
              </p>
            )
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-11 shrink-0 rounded-full lg:size-9"
          aria-label={rolled ? "Show chat" : "Hide chat"}
          title={rolled ? "Show chat" : "Hide chat (it keeps the chat)"}
          onClick={rolled ? actions.open : actions.close}
        >
          {rolled ? (
            <ChevronUp aria-hidden className="size-5" />
          ) : (
            <ChevronDown aria-hidden className="size-5" />
          )}
        </Button>
      </TitleBar>
      {!rolled && (
        <>
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
                  Ask about this card and your answer: why a step is wrong, or how to get it right.
                  The chat never changes the suggestion; rating the card ends it.
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
          <div className="flex flex-col gap-1.5 rounded-b-2xl border-t bg-background px-3 pt-2.5 pb-3">
            <Composer chat={chat} actions={actions} autoFocus={FOCUS_ON_OPEN} />
            <ComposerHint className="px-1" />
          </div>
        </>
      )}
    </section>
  );
}

/** Whether a press began on one of the bar's buttons, which don't move the window. */
const onButton = (target: EventTarget) =>
  target instanceof Element && target.closest("button") !== null;

/** Hands the pointer's travel (right and down are positive) to `onMove` while it is down. */
function useDrag(onMove: (dx: number, dy: number) => void) {
  const from = useRef<{ x: number; y: number } | undefined>(undefined);
  return {
    begin: (event: PointerEvent<HTMLElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      from.current = { x: event.clientX, y: event.clientY };
    },
    move: (event: PointerEvent<HTMLElement>) => {
      if (from.current === undefined) return false;
      onMove(event.clientX - from.current.x, event.clientY - from.current.y);
      return true;
    },
    end: () => {
      from.current = undefined;
    },
  };
}

/**
 * The window's title bar: from 640 px, drag it to move the window; a double
 * click puts it back at the bottom right. Rolled up, a tap rolls it down.
 */
function TitleBar({
  rect,
  setRect,
  onToggle,
  children,
}: {
  rect: Rect;
  setRect: (r: Rect | undefined) => void;
  onToggle: (() => void) | undefined;
  children: React.ReactNode;
}) {
  const start = useRef(rect);
  const moved = useRef(false);
  const drag = useDrag((dx, dy) => {
    if (Math.abs(dx) + Math.abs(dy) > 4) moved.current = true;
    setRect(fit({ ...start.current, x: start.current.x + dx, y: start.current.y + dy }));
  });
  const onKeyDown = (event: KeyboardEvent) => {
    const step = event.shiftKey ? 64 : 16;
    const d = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    }[event.key];
    if (d === undefined || event.target !== event.currentTarget) return;
    event.preventDefault();
    setRect(fit({ ...rect, x: rect.x + d[0]!, y: rect.y + d[1]! }));
  };
  return (
    <header
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onPointerDown={(event) => {
        if (!matchMedia(WIDE).matches || onButton(event.target)) return;
        moved.current = false;
        start.current = rect;
        drag.begin(event);
      }}
      onPointerMove={drag.move}
      onPointerUp={() => {
        drag.end();
        if (!moved.current && onToggle !== undefined) onToggle();
      }}
      onPointerCancel={drag.end}
      onDoubleClick={(event) => {
        if (!onButton(event.target)) setRect(undefined);
      }}
      title="Drag to move · double-click to put it back"
      className={cn(
        "flex shrink-0 items-center gap-2 border-b px-4 pb-1.5 sm:cursor-grab sm:touch-none sm:py-2 sm:pl-2 sm:select-none sm:active:cursor-grabbing",
        // Rolled up, the bar is all there is.
        onToggle !== undefined && "border-b-0 pb-0 sm:py-1.5",
      )}
    >
      <GripHorizontal
        aria-hidden
        className="hidden size-4 shrink-0 text-muted-foreground/60 sm:block"
      />
      {children}
    </header>
  );
}

/** Below 640 px, the sheet's top edge: drag it up or down; a tap jumps to its largest and back. */
function HeightGrip({ setHeight }: { setHeight: (height: number | undefined) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const moved = useRef(false);
  const start = useRef(MIN_HEIGHT);
  const current = () => ref.current?.parentElement?.offsetHeight ?? MIN_HEIGHT;
  const drag = useDrag((_, dy) => {
    if (Math.abs(dy) > 4) moved.current = true;
    setHeight(clamp(start.current - dy, MIN_HEIGHT, maxHeight()));
  });
  const onKeyDown = (event: KeyboardEvent) => {
    const step = event.key === "ArrowUp" ? 32 : event.key === "ArrowDown" ? -32 : 0;
    if (step === 0) return;
    event.preventDefault();
    setHeight(clamp(current() + step, MIN_HEIGHT, maxHeight()));
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
        start.current = current();
        drag.begin(event);
      }}
      onPointerMove={drag.move}
      onPointerUp={() => {
        drag.end();
        if (!moved.current) setHeight(current() >= maxHeight() - 8 ? undefined : maxHeight());
      }}
      onPointerCancel={drag.end}
      className="flex h-6 shrink-0 cursor-row-resize touch-none items-center justify-center outline-none focus-visible:bg-muted sm:hidden"
    >
      <span aria-hidden className="h-1 w-10 rounded-full bg-border" />
    </div>
  );
}

const EDGES = {
  n: "inset-x-4 top-0 h-2.5 -translate-y-1 cursor-ns-resize",
  s: "inset-x-4 bottom-0 h-2.5 translate-y-1 cursor-ns-resize",
  w: "inset-y-4 left-0 w-2.5 -translate-x-1 cursor-ew-resize",
  e: "inset-y-4 right-0 w-2.5 translate-x-1 cursor-ew-resize",
  nw: "-top-1.5 -left-1.5 size-5 cursor-nwse-resize",
  ne: "-top-1.5 -right-1.5 size-5 cursor-nesw-resize",
  sw: "-bottom-1.5 -left-1.5 size-5 cursor-nesw-resize",
  se: "-right-1.5 -bottom-1.5 size-5 cursor-nwse-resize",
} as const;
type Edge = keyof typeof EDGES;
const EDGE_NAMES: readonly Edge[] = ["n", "s", "w", "e", "nw", "ne", "sw", "se"];

/** The window's rect after dragging `edge` by (dx, dy), from `r`. */
function resized(r: Rect, edge: Edge, dx: number, dy: number): Rect {
  const b = bounds();
  let { x, y, w, h } = r;
  if (edge.includes("e")) w = clamp(r.w + dx, MIN_WIDTH, b.right - r.x);
  if (edge.includes("s")) h = clamp(r.h + dy, MIN_HEIGHT, b.bottom - r.y);
  if (edge.includes("w")) {
    w = clamp(r.w - dx, MIN_WIDTH, r.x + r.w - b.left);
    x = r.x + r.w - w;
  }
  if (edge.includes("n")) {
    h = clamp(r.h - dy, MIN_HEIGHT, r.y + r.h - b.top);
    y = r.y + r.h - h;
  }
  return { x, y, w, h };
}

/** From 640 px, an edge or a corner of the window: drag it to resize. The corners take arrow keys. */
function EdgeGrip({
  edge,
  rect,
  setRect,
}: {
  edge: Edge;
  rect: Rect;
  setRect: (r: Rect | undefined) => void;
}) {
  const start = useRef(rect);
  const drag = useDrag((dx, dy) => setRect(resized(start.current, edge, dx, dy)));
  const corner = edge.length === 2;
  const onKeyDown = (event: KeyboardEvent) => {
    const d = { ArrowLeft: [-32, 0], ArrowRight: [32, 0], ArrowUp: [0, -32], ArrowDown: [0, 32] }[
      event.key
    ];
    if (d === undefined) return;
    event.preventDefault();
    setRect(resized(rect, edge, d[0]!, d[1]!));
  };
  return (
    <div
      role="separator"
      aria-label="Resize the chat"
      tabIndex={edge === "nw" ? 0 : -1}
      onKeyDown={onKeyDown}
      onPointerDown={(event) => {
        start.current = rect;
        drag.begin(event);
      }}
      onPointerMove={drag.move}
      onPointerUp={drag.end}
      onPointerCancel={drag.end}
      className={cn(
        "group absolute z-10 hidden touch-none outline-none sm:block",
        corner && "z-20",
        EDGES[edge],
      )}
    >
      {edge === "se" && (
        <span
          aria-hidden
          className="absolute right-2.5 bottom-2.5 size-2 rounded-br-sm border-r-2 border-b-2 border-muted-foreground/40 transition-colors group-hover:border-primary"
        />
      )}
    </div>
  );
}

/** Below 640 px, the hidden sheet: a pill floating at the bottom right, just above the dock. */
function HiddenPill({ chat, onShow }: { chat: Chat; onShow: () => void }) {
  const count = chat.messages.length;
  const busy = replying(chat);
  const status = busy ? "Replying…" : count === 0 ? "Nothing asked yet" : `${count}`;
  return (
    <button
      type="button"
      onClick={onShow}
      aria-label={`Show chat, ${busy ? "replying" : `${count} messages`}`}
      title="Show chat"
      className={cn(
        PILL,
        "fixed right-3 bottom-[calc(var(--dock-h,7.75rem)+0.75rem)] z-20 flex h-11 items-center gap-2 border bg-background pr-2 pl-3.5 text-sm shadow-[0_12px_32px_-12px_oklch(0_0_0/0.45)] transition-colors hover:bg-muted",
        "[body:has([data-chat-composer]:focus-within)_&]:hidden",
      )}
    >
      <MessageCircleQuestion aria-hidden className="size-4 shrink-0 text-primary" />
      <span className="font-medium">Ask the Grader</span>
      <span
        className={cn(
          "flex h-7 min-w-7 items-center justify-center gap-1.5 rounded-full px-2 text-xs tabular-nums",
          busy ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
        )}
      >
        {busy && (
          <span
            aria-hidden
            className="size-1.5 animate-pulse rounded-full bg-primary motion-reduce:animate-none"
          />
        )}
        {status}
      </span>
    </button>
  );
}

/** Below the sheet on a phone: a thin shade over the Card, which a tap puts away. */
export function SheetShade() {
  const [chat, actions, live] = useChat();
  if (!live || !chat.open) return null;
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label="Hide chat"
      onClick={actions.close}
      className="fixed inset-x-0 top-[calc(3.5rem+env(safe-area-inset-top))] bottom-[var(--dock-h,7.75rem)] z-[19] bg-background/50 sm:hidden"
    />
  );
}
