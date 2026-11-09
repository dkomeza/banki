import type { Rating } from "@banki/shared";
import { ChevronDown, MessageCircleQuestion, Sparkles } from "lucide-react";
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

// PROTOTYPE (BAN-42), Variant f, "Float sheet": d's grip sheet, floating over
// the page at every size, so the Card never moves for it. Below 1024 px it
// rises from the dock as in d, by the grip on its top edge. From 1024 px it is
// a card floating at the window's bottom right, just above the dock, sized by
// its left edge, its top edge or the corner between them; it covers what is
// under it, and the Card scrolls on beneath. Hide folds it into a pill at the
// same corner, over the page too, with the count or "Replying…".

/** The sizes the User dragged the sheet to, kept across reloads. */
const SIZE_KEY = "banki.proto.chat-float";
/** `height` below 1024 px; `width` and `tall` (its height) from there. */
type Size = { height?: number; width?: number; tall?: number };
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
const dockHeight = () =>
  Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue("--dock-h") || "124",
  );
/** Below 1024 px: leaves the top bar and a strip of the Card above the sheet. */
const maxHeight = () => Math.max(MIN_HEIGHT, window.innerHeight - dockHeight() - 56 - 24);
/** From 1024 px: up to the top bar, with a gap. */
const maxTall = () => Math.max(MIN_HEIGHT, window.innerHeight - dockHeight() - 56 - 32);
/** From 1024 px: leaves a gap at the window's left edge. */
const maxWidth = () => Math.max(MIN_WIDTH, Math.min(880, window.innerWidth - 64));

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

/** The chat's sheet, floating over the page; or, hidden, its pill. */
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
  useEffect(() => writeSize(size), [size]);
  if (!live || !chat.started) return null;
  if (!chat.open) return <HiddenPill chat={chat} onShow={actions.open} />;
  const vars: Record<string, string> = {};
  if (size.height !== undefined) vars["--chat-h"] = `${size.height}px`;
  if (size.width !== undefined) vars["--chat-w"] = `${size.width}px`;
  if (size.tall !== undefined) vars["--chat-tall"] = `${size.tall}px`;
  return (
    <section
      aria-label="Follow-up chat"
      style={vars}
      className={cn(
        "fixed inset-x-0 z-20 flex flex-col overflow-hidden border bg-background shadow-[0_-12px_32px_-16px_oklch(0_0_0/0.35)]",
        // Below 1024 px: from the dock up, as tall as dragged to.
        "bottom-[calc(var(--dock-h,7.75rem)+0.5rem)] mx-2 max-h-[calc(100dvh-var(--dock-h,7.75rem)-4.5rem-env(safe-area-inset-top))] min-h-60 rounded-2xl sm:mx-auto sm:w-[min(40rem,calc(100%-3rem))]",
        size.height === undefined ? "max-lg:h-[min(60dvh,32rem)]" : "max-lg:h-[var(--chat-h)]",
        // Its input focused, the dock steps aside: it sits on the formatting bar, over the keyboard.
        "max-lg:[body:has([data-chat-composer]:focus-within)_&]:bottom-[calc(var(--keyboard-inset,0px)+0.5rem)] max-sm:[body:has([data-chat-composer]:focus-within)_&]:bottom-[calc(max(var(--keyboard-inset,0px),3.9rem+env(safe-area-inset-bottom))+4.25rem)] max-lg:[body:has([data-chat-composer]:focus-within)_&]:max-h-[calc(100dvh-var(--keyboard-inset,0px)-9rem)]",
        // From 1024 px: a card at the bottom right, over the page, as wide and tall as dragged to. Its
        // grips reach past its edges, so it doesn't clip.
        "lg:overflow-visible lg:right-4 lg:bottom-[calc(var(--dock-h,7.75rem)+0.75rem)] lg:left-auto lg:mx-0 lg:h-[var(--chat-tall,min(36rem,calc(100dvh-var(--dock-h,7.75rem)-5.5rem)))] lg:max-h-[calc(100dvh-var(--dock-h,7.75rem)-5.5rem)] lg:w-[var(--chat-w,26rem)] lg:shadow-[0_24px_64px_-24px_oklch(0_0_0/0.45),0_2px_8px_-4px_oklch(0_0_0/0.2)] xl:w-[var(--chat-w,28rem)]",
      )}
    >
      <HeightGrip setSize={setSize} />
      <EdgeGrip edge="left" setSize={setSize} />
      <EdgeGrip edge="top" setSize={setSize} />
      <EdgeGrip edge="corner" setSize={setSize} />
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
          <ChevronDown aria-hidden className="size-5" />
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
      <div className="flex flex-col gap-1.5 rounded-b-2xl border-t bg-background px-3 pt-2.5 pb-3">
        <Composer chat={chat} actions={actions} autoFocus={FOCUS_ON_OPEN} />
        <ComposerHint className="px-1" />
      </div>
    </section>
  );
}

type GripProps = {
  setSize: (change: (size: Size) => Size) => void;
};

/** Hands the pointer's travel (left and up are positive) to `onMove` while it is down. */
function useDrag(onMove: (dx: number, dy: number) => void) {
  const from = useRef<{ x: number; y: number } | undefined>(undefined);
  return {
    begin: (event: PointerEvent<HTMLElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      from.current = { x: event.clientX, y: event.clientY };
    },
    move: (event: PointerEvent<HTMLElement>) => {
      if (from.current === undefined) return;
      onMove(from.current.x - event.clientX, from.current.y - event.clientY);
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
  const start = useRef(MIN_HEIGHT);
  const current = () => ref.current?.parentElement?.offsetHeight ?? MIN_HEIGHT;
  const drag = useDrag((_, dy) => {
    if (Math.abs(dy) > 4) moved.current = true;
    const height = clamp(start.current + dy, MIN_HEIGHT, maxHeight());
    setSize((s) => ({ ...s, height }));
  });
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
        start.current = current();
        drag.begin(event);
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

const EDGE = {
  left: "inset-y-4 left-0 w-3 -translate-x-1.5 cursor-col-resize",
  top: "inset-x-4 top-0 h-3 -translate-y-1.5 cursor-row-resize",
  corner: "-top-2 -left-2 size-6 cursor-nwse-resize",
} as const;

/**
 * From 1024 px, the card's left edge (its width), top edge (its height) or
 * the corner between them (both). A double click puts it back to its default.
 */
function EdgeGrip({ edge, setSize }: GripProps & { edge: keyof typeof EDGE }) {
  const ref = useRef<HTMLDivElement>(null);
  const start = useRef({ width: MIN_WIDTH, tall: MIN_HEIGHT });
  const card = () => ref.current?.parentElement;
  const drag = useDrag((dx, dy) =>
    setSize((s) => ({
      ...s,
      ...(edge !== "top" && {
        width: clamp(start.current.width + dx, MIN_WIDTH, maxWidth()),
      }),
      ...(edge !== "left" && {
        tall: clamp(start.current.tall + dy, MIN_HEIGHT, maxTall()),
      }),
    })),
  );
  const onKeyDown = (event: KeyboardEvent) => {
    const x = event.key === "ArrowLeft" ? 32 : event.key === "ArrowRight" ? -32 : 0;
    const y = event.key === "ArrowUp" ? 32 : event.key === "ArrowDown" ? -32 : 0;
    if ((edge === "top" ? y : edge === "left" ? x : x || y) === 0) return;
    event.preventDefault();
    const el = card();
    setSize((s) => ({
      ...s,
      ...(edge !== "top" &&
        x !== 0 && {
          width: clamp((el?.offsetWidth ?? 0) + x, MIN_WIDTH, maxWidth()),
        }),
      ...(edge !== "left" &&
        y !== 0 && {
          tall: clamp((el?.offsetHeight ?? 0) + y, MIN_HEIGHT, maxTall()),
        }),
    }));
  };
  return (
    <div
      ref={ref}
      role="separator"
      aria-orientation={edge === "top" ? "horizontal" : "vertical"}
      aria-label={
        edge === "left"
          ? "Resize the chat's width"
          : edge === "top"
            ? "Resize the chat's height"
            : "Resize the chat"
      }
      title="Drag to resize · double-click for the default size"
      tabIndex={edge === "corner" ? 0 : -1}
      onKeyDown={onKeyDown}
      onPointerDown={(event) => {
        const el = card();
        start.current = {
          width: el?.offsetWidth ?? MIN_WIDTH,
          tall: el?.offsetHeight ?? MIN_HEIGHT,
        };
        drag.begin(event);
      }}
      onPointerMove={drag.move}
      onPointerUp={drag.end}
      onPointerCancel={drag.end}
      onDoubleClick={() =>
        setSize((s) => ({
          ...s,
          ...(edge !== "top" && { width: undefined }),
          ...(edge !== "left" && { tall: undefined }),
        }))
      }
      className={cn(
        "group absolute z-10 hidden touch-none items-center justify-center outline-none lg:flex",
        EDGE[edge],
      )}
    >
      {edge === "corner" ? (
        <span
          aria-hidden
          className="size-2.5 rounded-full border bg-background transition-colors group-hover:border-primary group-focus-visible:border-primary group-focus-visible:bg-primary group-active:bg-primary"
        />
      ) : (
        <span
          aria-hidden
          className={cn(
            "rounded-full bg-transparent transition-colors group-hover:bg-primary/50 group-active:bg-primary",
            edge === "left" ? "h-full w-0.5" : "h-0.5 w-full",
          )}
        />
      )}
    </div>
  );
}

/** The hidden sheet: a pill floating at the bottom right, just above the dock. */
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
        "fixed right-3 bottom-[calc(var(--dock-h,7.75rem)+0.75rem)] z-20 flex h-11 items-center gap-2 border bg-background pr-2 pl-3.5 text-sm shadow-[0_12px_32px_-12px_oklch(0_0_0/0.45)] transition-colors hover:bg-muted sm:right-6 lg:right-4",
        "max-lg:[body:has([data-chat-composer]:focus-within)_&]:hidden",
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
