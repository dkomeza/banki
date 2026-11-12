import { useLocation, useNavigate } from "@tanstack/react-router";
import { Eraser, PenLine, Redo2, Signature, Trash2, Undo2 } from "lucide-react";
import {
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import type { StudyState } from "@/lib/study";
import { cn } from "@/lib/utils";

// PROTOTYPE (BAN-45): handwriting on the study screen, in write-and-grade
// before Check. Rough, throwaway ink: a pen or a mouse draws, one finger pans,
// the wheel pans, and the canvas grows without bound, so the page never
// scrolls. The tools work roughly too, so a Variant can be tried with a real
// stylus. Reached by `?state=` (`ink`, `ink-written`, `ink-long-front`) or by
// the top bar's Handwrite (`?handwriting=1`, on whatever Card shows).

export const INK_STATES = ["ink", "ink-written", "ink-long-front"] as const;
type InkState = (typeof INK_STATES)[number];

/** The seeded Maclaurin series Card's Front. */
const MACLAURIN_FRONT =
  "Derive the Maclaurin series of $\\ln(1+x)$.\n\nFor which $x$ does it converge?";

/** A Front taller than half the screen, with display math and an Image. */
const LONG_FRONT = [
  "The curve below is $y = \\ln(1+x)$ with its first few Maclaurin polynomials.",
  "",
  "![](images/5eed0000-0000-4000-8000-00000000a001.png)",
  "",
  "Starting from the series",
  "$$\\ln(1+x) = \\sum_{n=1}^{\\infty} (-1)^{n+1} \\frac{x^n}{n} = x - \\frac{x^2}{2} + \\frac{x^3}{3} - \\cdots$$",
  "estimate $\\ln(1.5)$ to three decimal places, and bound the error with the alternating series estimate",
  "$$\\lvert R_N \\rvert \\le \\frac{\\lvert x \\rvert^{N+1}}{N+1}.$$",
  "How many terms do you need?",
  "",
  "Then explain why the same series can't give $\\ln 3$ directly, and how $\\ln 3 = \\ln 2 + \\ln 1.5$ gets around it.",
].join("\n");

export type Handwriting = {
  /** The handwriting layout shows. */
  on: boolean;
  /** The Front to show: a state's own, or the Card's. */
  front: string;
  /** The `?state=` it shows, keying the canvas so each starts afresh. */
  state: InkState | undefined;
};

/** Whether the shown Card is in handwriting, and the Front it shows. */
export function useHandwriting(state: StudyState): Handwriting {
  const search = useLocation({
    select: (l) => {
      const s: Record<string, unknown> = l.search;
      return { state: s["state"], handwriting: s["handwriting"] };
    },
  });
  const named = INK_STATES.find((s) => s === search.state);
  const asked = named !== undefined || String(search.handwriting) === "1";
  const card = state.shown?.card;
  const on =
    asked &&
    state.phase === "card" &&
    card !== undefined &&
    state.mode === "write" &&
    !state.revealed;
  const front =
    named === "ink-long-front"
      ? LONG_FRONT
      : named !== undefined
        ? MACLAURIN_FRONT
        : (card?.front ?? "");
  return { on, front, state: named };
}

/** In the top bar, before Write: on and off with `?handwriting=1`, in write-and-grade before the reveal. */
export function HandwriteToggle({ state, on }: { state: StudyState; on: boolean }) {
  const navigate = useNavigate();
  if (state.phase !== "card" || state.mode !== "write" || state.revealed) return null;
  const toggle = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete("state");
    if (on) url.searchParams.delete("handwriting");
    else url.searchParams.set("handwriting", "1");
    void navigate({ href: url.pathname + url.search, replace: true });
  };
  return (
    <Button
      variant="ghost"
      aria-pressed={on}
      onClick={toggle}
      onMouseDown={(event) => event.preventDefault()}
      aria-label="Handwrite"
      title="Handwrite (prototype)"
      className={cn(
        "h-11 min-w-11 gap-1.5 rounded-full px-3 lg:h-9 lg:min-w-9",
        on && "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary",
      )}
    >
      <Signature aria-hidden className="size-4" />
      <span className="hidden sm:inline">Handwrite</span>
    </Button>
  );
}

// --- Ink ---------------------------------------------------------------------

type Point = { x: number; y: number; p: number };
type Stroke = { points: Point[]; width: number };
export type Tool = "pen" | "eraser";
export const WIDTHS = [1.5, 2.5, 4] as const;

/** The ink and the tools, shared by the canvas and the tool bar. */
export function useInk(sample: boolean) {
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [undone, setUndone] = useState<Stroke[][]>([]);
  const [history, setHistory] = useState<Stroke[][]>([]);
  const [tool, setTool] = useState<Tool>("pen");
  const [width, setWidth] = useState<number>(WIDTHS[1]);
  const [sampled, setSampled] = useState(!sample);
  const commit = useCallback(
    (next: Stroke[]) => {
      setHistory((h) => [...h, strokes]);
      setUndone([]);
      setStrokes(next);
    },
    [strokes],
  );
  return {
    strokes,
    tool,
    width,
    setTool,
    setWidth,
    /** Fills the sample once the canvas knows its width. */
    sampleFor(columns: number) {
      if (sampled) return;
      setSampled(true);
      setStrokes(sampleStrokes(columns));
    },
    add: (stroke: Stroke) => commit([...strokes, stroke]),
    replace: (next: Stroke[]) => commit(next),
    canUndo: history.length > 0,
    canRedo: undone.length > 0,
    undo: () => {
      const last = history.at(-1);
      if (last === undefined) return;
      setHistory((h) => h.slice(0, -1));
      setUndone((u) => [...u, strokes]);
      setStrokes(last);
    },
    redo: () => {
      const next = undone.at(-1);
      if (next === undefined) return;
      setUndone((u) => u.slice(0, -1));
      setHistory((h) => [...h, strokes]);
      setStrokes(next);
    },
    clear: () => commit([]),
    empty: strokes.length === 0,
  };
}
export type Ink = ReturnType<typeof useInk>;

/** Scribbled lines of "handwriting" down `columns` px, running well past one screen. */
function sampleStrokes(columns: number): Stroke[] {
  let seed = 7;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const strokes: Stroke[] = [];
  const left = 28;
  const right = Math.max(left + 160, columns - 28);
  for (let row = 0; row < 30; row++) {
    const baseline = 64 + row * 48;
    let x = left + (row % 6 === 0 ? 0 : 12);
    // Every so often, an equation line ends short, and a blank line follows.
    const end = row % 5 === 4 ? left + (right - left) * 0.55 : right;
    if (row % 7 === 6) continue;
    while (x < end - 30) {
      const length = 30 + rand() * 70;
      const points: Point[] = [];
      for (let t = 0; t <= length; t += 1.5) {
        const phase = t / 5.5;
        points.push({
          x: x + t + Math.sin(phase * 2.1) * 3,
          y: baseline - 6 - Math.abs(Math.sin(phase)) * (8 + rand() * 6),
          p: 0.5,
        });
      }
      strokes.push({ points, width: WIDTHS[1] });
      // Now and then a fraction bar or an equals sign under or after the word.
      if (rand() < 0.18) {
        strokes.push({
          points: [
            { x: x + length + 8, y: baseline - 12, p: 0.5 },
            { x: x + length + 22, y: baseline - 12, p: 0.5 },
          ],
          width: WIDTHS[1],
        });
        strokes.push({
          points: [
            { x: x + length + 8, y: baseline - 6, p: 0.5 },
            { x: x + length + 22, y: baseline - 6, p: 0.5 },
          ],
          width: WIDTHS[1],
        });
        x += 26;
      }
      x += length + 14 + rand() * 10;
    }
  }
  return strokes;
}

/** The paper behind the ink: CSS, moved with the pan. */
export type Paper = "ruled" | "grid" | "plain";

const PAPER: Record<Paper, string> = {
  ruled:
    "bg-[repeating-linear-gradient(to_bottom,transparent_0,transparent_47px,var(--border)_47px,var(--border)_48px)]",
  grid: "bg-[linear-gradient(to_right,color-mix(in_oklch,var(--border)_70%,transparent)_1px,transparent_1px),linear-gradient(to_bottom,color-mix(in_oklch,var(--border)_70%,transparent)_1px,transparent_1px)] bg-[size:24px_24px]",
  plain: "",
};

/** Where the canvas looks: the paper's point at its top-left, and how large the paper is drawn. */
export type View = { x: number; y: number; zoom: number };

/** The smallest and largest the board zooms to, where it zooms. */
export const BOARD_ZOOM = { min: 0.3, max: 3 } as const;

/** What's on the paper gets the view, and a way to change it. */
export type Board = View & {
  /** Zooms to `zoom` about a point on the canvas (its centre when not given). */
  zoomTo: (zoom: number, about?: { x: number; y: number }) => void;
  /** Shows the paper's `rect` whole, as large as fits (no larger than 100%). */
  fit: (rect: { x: number; y: number; w: number; h: number }) => void;
  /** Pans so the paper's `point` is at the canvas's top-left, less `margin`. */
  panTo: (point: { x: number; y: number }, margin?: number) => void;
  /** The canvas's size on screen. */
  w: number;
  h: number;
};

/**
 * The canvas: a viewport onto paper that grows without bound. A pen or a mouse
 * draws (or erases), one finger or the wheel pans; the page never scrolls.
 * When `zoomable`, two fingers pinch and Ctrl+wheel (a trackpad's pinch) zoom
 * the paper and everything on it. `inset` keeps the first line clear of what
 * floats over its top.
 */
export function InkCanvas({
  ink,
  paper,
  sample,
  label = "Handwritten answer",
  className,
  inset = 0,
  zoomable = false,
  onPaperDown,
  onCtrlWheel,
  renderOnPaper,
  children,
}: {
  ink: Ink;
  paper: Paper;
  sample: boolean;
  label?: string;
  className?: string;
  inset?: number;
  zoomable?: boolean;
  /** A pen, mouse or finger came down on the paper itself. */
  onPaperDown?: () => void;
  /** Ctrl+wheel where the board doesn't zoom, with what it was over. */
  onCtrlWheel?: (event: WheelEvent) => void;
  /** What sits on the paper itself, so it pans (and zooms) with the ink. */
  renderOnPaper?: (board: Board) => ReactNode;
  children?: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [view, setView] = useState<View>({ x: 0, y: 0, zoom: 1 });
  const [size, setSize] = useState({ w: 0, h: 0 });
  const live = useRef<Stroke | null>(null);
  /** The fingers down on the paper, where each last was. */
  const fingers = useRef(new Map<number, { x: number; y: number }>());

  useLayoutEffect(() => {
    const el = box.current;
    if (el === null) return () => {};
    const observer = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    observer.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (sample && size.w > 0) ink.sampleFor(Math.min(size.w, 960));
  }, [sample, size.w, ink]);

  const draw = useCallback(() => {
    const el = canvas.current;
    if (el === null) return;
    const ratio = window.devicePixelRatio || 1;
    if (el.width !== Math.round(size.w * ratio)) el.width = Math.round(size.w * ratio);
    if (el.height !== Math.round(size.h * ratio)) el.height = Math.round(size.h * ratio);
    const ctx = el.getContext("2d");
    if (ctx === null) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);
    ctx.translate(0, inset);
    ctx.scale(view.zoom, view.zoom);
    ctx.translate(-view.x, -view.y);
    ctx.strokeStyle = getComputedStyle(el).color;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const all = live.current === null ? ink.strokes : [...ink.strokes, live.current];
    for (const stroke of all) {
      const [first, ...rest] = stroke.points;
      if (first === undefined) continue;
      ctx.lineWidth = stroke.width * (0.6 + (first.p || 0.5) * 0.8);
      ctx.beginPath();
      ctx.moveTo(first.x, first.y);
      if (rest.length === 0) ctx.lineTo(first.x + 0.1, first.y);
      for (const point of rest) ctx.lineTo(point.x, point.y);
      ctx.stroke();
    }
  }, [ink.strokes, view, size, inset]);
  useEffect(draw, [draw]);

  const onPaper = (clientX: number, clientY: number): Point => {
    const rect = box.current!.getBoundingClientRect();
    return {
      x: (clientX - rect.left) / view.zoom + view.x,
      y: (clientY - rect.top - inset) / view.zoom + view.y,
      p: 0.5,
    };
  };
  const at = (event: { clientX: number; clientY: number; pressure: number }): Point => ({
    ...onPaper(event.clientX, event.clientY),
    p: event.pressure,
  });
  const erase = (point: Point) => {
    const reach = 12 / view.zoom;
    const near = (s: Stroke) =>
      s.points.some((q) => Math.hypot(q.x - point.x, q.y - point.y) < reach);
    const kept = ink.strokes.filter((s) => !near(s));
    if (kept.length !== ink.strokes.length) ink.replace(kept);
  };
  const panBy = useCallback(
    (dx: number, dy: number) =>
      setView((v) => ({
        ...v,
        x: Math.max(0, v.x - dx / v.zoom),
        y: Math.max(0, v.y - dy / v.zoom),
      })),
    [],
  );
  /** Zooms to what `to` gives for the zoom now, keeping the paper under `about` where it is. */
  const zoomWith = useCallback(
    (to: (zoom: number) => number, about?: { x: number; y: number }) =>
      setView((v) => {
        const z = clamp(to(v.zoom), BOARD_ZOOM.min, BOARD_ZOOM.max);
        const ax = about?.x ?? size.w / 2;
        const ay = about?.y ?? size.h / 2;
        return {
          zoom: z,
          x: Math.max(0, ax / v.zoom + v.x - ax / z),
          y: Math.max(0, ay / v.zoom + v.y - ay / z),
        };
      }),
    [size],
  );

  // Native, so a wheel can stop the page's own scroll or zoom.
  const wheel = useRef({ zoomable, onCtrlWheel, panBy, zoomWith });
  useLayoutEffect(() => {
    wheel.current = { zoomable, onCtrlWheel, panBy, zoomWith };
  });
  useEffect(() => {
    const el = box.current;
    if (el === null) return () => {};
    const onWheel = (event: WheelEvent) => {
      const own = event.target instanceof Element && event.target.closest("[data-own-wheel]");
      const w = wheel.current;
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        if (w.zoomable) {
          const rect = el.getBoundingClientRect();
          w.zoomWith((z) => z * Math.exp(-event.deltaY * 0.01), {
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
          });
          return;
        }
        w.onCtrlWheel?.(event);
        return;
      }
      if (own) return;
      event.preventDefault();
      w.panBy(-event.deltaX, -event.deltaY);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const board: Board = {
    ...view,
    w: size.w,
    h: size.h,
    zoomTo: (zoom, about) => zoomWith(() => zoom, about),
    fit: (rect) => {
      const margin = 24;
      const zoom = clamp(
        Math.min(1, (size.w - margin * 2 - 56) / rect.w, (size.h - margin * 2) / rect.h),
        BOARD_ZOOM.min,
        BOARD_ZOOM.max,
      );
      setView({
        zoom,
        x: Math.max(0, rect.x - margin / zoom),
        y: Math.max(0, rect.y - margin / zoom),
      });
    },
    panTo: (point, margin = 12) =>
      setView((v) => ({
        ...v,
        x: Math.max(0, point.x - margin / v.zoom),
        y: Math.max(0, point.y - margin / v.zoom),
      })),
  };

  const grid = 24 * view.zoom;
  return (
    <div
      ref={box}
      role="img"
      aria-label={label}
      className={cn("relative min-h-0 overflow-hidden", className)}
    >
      <div
        aria-hidden
        className={cn("absolute inset-0", PAPER[paper])}
        style={{
          backgroundPosition: `${-view.x * view.zoom}px ${-view.y * view.zoom + inset}px`,
          ...(paper === "grid" && view.zoom !== 1 && { backgroundSize: `${grid}px ${grid}px` }),
        }}
      />
      <canvas
        ref={canvas}
        className="absolute inset-0 size-full touch-none text-foreground"
        style={{ cursor: ink.tool === "eraser" ? "cell" : "crosshair" }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          onPaperDown?.();
          if (event.pointerType === "touch") {
            fingers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
            return;
          }
          if (event.button !== 0) return;
          if (ink.tool === "eraser") {
            erase(at(event));
            return;
          }
          live.current = { points: [at(event)], width: ink.width };
          draw();
        }}
        onPointerMove={(event) => {
          const fingersDown = fingers.current;
          const last = fingersDown.get(event.pointerId);
          if (last !== undefined) {
            const others = [...fingersDown].filter(([id]) => id !== event.pointerId);
            const other = others[0]?.[1];
            if (zoomable && other !== undefined) {
              // Two fingers: zoom by how far apart they moved, about their midpoint, and pan with it.
              const rect = box.current!.getBoundingClientRect();
              const before = Math.hypot(last.x - other.x, last.y - other.y);
              const after = Math.hypot(event.clientX - other.x, event.clientY - other.y);
              const mid = {
                x: (event.clientX + other.x) / 2 - rect.left,
                y: (event.clientY + other.y) / 2 - rect.top,
              };
              if (before > 0) zoomWith((z) => z * (after / before), mid);
              panBy((event.clientX - last.x) / 2, (event.clientY - last.y) / 2);
            } else if (others.length === 0) {
              panBy(event.clientX - last.x, event.clientY - last.y);
            }
            fingersDown.set(event.pointerId, { x: event.clientX, y: event.clientY });
            return;
          }
          if (event.buttons === 0) return;
          if (ink.tool === "eraser") {
            erase(at(event));
            return;
          }
          if (live.current === null) return;
          for (const e of event.nativeEvent.getCoalescedEvents?.() ?? [event.nativeEvent]) {
            live.current.points.push(at(e));
          }
          draw();
        }}
        onPointerUp={(event) => {
          fingers.current.delete(event.pointerId);
          if (live.current !== null) ink.add(live.current);
          live.current = null;
        }}
        onPointerCancel={(event) => {
          fingers.current.delete(event.pointerId);
          live.current = null;
          draw();
        }}
      />
      {renderOnPaper?.(board)}
      {children}
    </div>
  );
}

// --- The tool bar ----------------------------------------------------------------

const TOOL =
  "flex size-11 shrink-0 items-center justify-center rounded-full text-foreground outline-none transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-40 aria-pressed:bg-primary/10 aria-pressed:text-primary lg:size-9";

/** Pen (with its thickness), eraser, undo, redo and clear, in a row or a column. */
export function ToolBar({
  ink,
  vertical = false,
  className,
}: {
  ink: Ink;
  vertical?: boolean;
  className?: string;
}) {
  const divider = vertical ? "mx-auto h-px w-6 bg-border" : "my-auto h-6 w-px bg-border";
  return (
    <div
      role="toolbar"
      aria-label="Handwriting tools"
      aria-orientation={vertical ? "vertical" : "horizontal"}
      className={cn("flex items-center gap-0.5", vertical && "flex-col", className)}
    >
      <button
        type="button"
        aria-label="Pen"
        aria-pressed={ink.tool === "pen"}
        className={TOOL}
        onClick={() => ink.setTool("pen")}
      >
        <PenLine aria-hidden className="size-[1.15rem]" />
      </button>
      <div
        role="radiogroup"
        aria-label="Pen thickness"
        className={cn("flex items-center", vertical && "flex-col")}
      >
        {WIDTHS.map((w, i) => (
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a prototype's swatch
          <button
            key={w}
            type="button"
            role="radio"
            aria-checked={ink.width === w}
            aria-label={["Fine", "Medium", "Bold"][i]}
            className={cn(TOOL, "w-8 lg:w-7", vertical && "h-8 w-11 lg:h-7 lg:w-9")}
            onClick={() => {
              ink.setWidth(w);
              ink.setTool("pen");
            }}
          >
            <span
              aria-hidden
              className={cn(
                "rounded-full bg-current",
                ink.width === w && ink.tool === "pen" ? "text-primary" : "text-muted-foreground",
              )}
              style={{ width: 3 + w * 2, height: 3 + w * 2 }}
            />
          </button>
        ))}
      </div>
      <button
        type="button"
        aria-label="Eraser"
        aria-pressed={ink.tool === "eraser"}
        className={TOOL}
        onClick={() => ink.setTool("eraser")}
      >
        <Eraser aria-hidden className="size-[1.15rem]" />
      </button>
      <span aria-hidden className={divider} />
      <button
        type="button"
        aria-label="Undo stroke"
        disabled={!ink.canUndo}
        className={TOOL}
        onClick={ink.undo}
      >
        <Undo2 aria-hidden className="size-[1.15rem]" />
      </button>
      <button
        type="button"
        aria-label="Redo stroke"
        disabled={!ink.canRedo}
        className={TOOL}
        onClick={ink.redo}
      >
        <Redo2 aria-hidden className="size-[1.15rem]" />
      </button>
      <button
        type="button"
        aria-label="Clear"
        disabled={ink.empty}
        className={TOOL}
        onClick={ink.clear}
      >
        <Trash2 aria-hidden className="size-[1.15rem]" />
      </button>
    </div>
  );
}

/** Whether `el` holds more than it shows, kept up to date as it or its content resizes. */
export function useOverflows<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [overflows, setOverflows] = useState(false);
  const [atEnd, setAtEnd] = useState(true);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return () => {};
    const check = () => {
      setOverflows(el.scrollHeight > el.clientHeight + 1);
      setAtEnd(el.scrollTop + el.clientHeight >= el.scrollHeight - 2);
    };
    const observer = new ResizeObserver(check);
    observer.observe(el);
    for (const child of el.children) observer.observe(child);
    el.addEventListener("scroll", check, { passive: true });
    check();
    return () => {
      observer.disconnect();
      el.removeEventListener("scroll", check);
    };
  }, []);
  return [ref, { overflows, atEnd }] as const;
}

// --- Moving and scaling the note --------------------------------------------------

/**
 * Pointer handlers for a drag, by pen, mouse or finger: `move` gets the
 * distance from where it started, `end` runs when it's let go. A press on a
 * button inside it stays the button's.
 */
export function useDrag(
  move: (dx: number, dy: number) => void,
  end?: () => void,
  start?: () => void,
) {
  const from = useRef<{ id: number; x: number; y: number } | null>(null);
  const handlers = useRef({ move, end, start });
  useLayoutEffect(() => {
    handlers.current = { move, end, start };
  });
  return {
    onPointerDown: (event: ReactPointerEvent) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      const target = event.target;
      if (
        target !== event.currentTarget &&
        target instanceof Element &&
        target.closest("button") !== null
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      from.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
      handlers.current.start?.();
    },
    onPointerMove: (event: ReactPointerEvent) => {
      const f = from.current;
      if (f === null || f.id !== event.pointerId) return;
      handlers.current.move(event.clientX - f.x, event.clientY - f.y);
    },
    onPointerUp: (event: ReactPointerEvent) => {
      if (from.current === null || from.current.id !== event.pointerId) return;
      from.current = null;
      handlers.current.end?.();
    },
    onPointerCancel: () => {
      if (from.current === null) return;
      from.current = null;
      handlers.current.end?.();
    },
  };
}
export type Drag = ReturnType<typeof useDrag>;

/** The smallest and largest the note scales to. */
export const NOTE_SCALE = { min: 0.6, max: 2 } as const;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

/**
 * Where the note sits and how large it is, kept in localStorage for the
 * Variant, so it stays put from Card to Card and across reloads.
 */
export function useNoteFrame<T extends object>(key: string, initial: T) {
  const storageKey = `banki.proto.ban45.${key}`;
  const [frame, setFrame] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      const parsed: unknown = stored === null ? null : JSON.parse(stored);
      return typeof parsed === "object" && parsed !== null ? { ...initial, ...parsed } : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(frame));
  }, [storageKey, frame]);
  return [frame, setFrame] as const;
}

/** The size of the element it's given, kept up to date, from whenever it mounts. */
export function useSize<T extends HTMLElement>() {
  const [el, ref] = useState<T | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    if (el === null) return () => {};
    const measure = () => setSize({ w: el.offsetWidth, h: el.offsetHeight });
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    measure();
    return () => observer.disconnect();
  }, [el]);
  return [ref, size] as const;
}
