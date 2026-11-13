import { Eraser, Minus, PenLine, Plus, Redo2, ScanSearch, Trash2, Undo2 } from "lucide-react";
import { type KeyboardEvent, type PointerEvent, useLayoutEffect, useRef, useState } from "react";
import { CardText } from "@/components/cards/card-text";
import {
  type Corner,
  FRONT_AT,
  FRONT_SCALE,
  clamp,
  frontWidth,
  keepOnCanvas,
  scaleFromCorner,
  startScale,
} from "@/lib/handwriting";
import { cn } from "@/lib/utils";

// Handwriting on the study screen ("Bare board", BAN-45; docs/design.md §
// Handwriting): in write-and-grade before Check, the canvas takes the whole
// screen between the top bar and the dock, on grid paper, and the Front sits on
// it like an image on a board. Tap the Front to select it, drag it to move it,
// pull a corner to scale it; tap the paper to let go of it. A long Front starts
// scaled down to fit. The tool bar stands at the right edge, and the zoom
// control at the bottom-left.
//
// For now it is a shell, reached only by `?handwriting=1`: nothing draws, the
// canvas doesn't pan or zoom, and the tools and the zoom control are disabled.

/** The paper: a 24 px grid in the hairline colour. */
const GRID =
  "bg-[linear-gradient(to_right,color-mix(in_oklch,var(--border)_70%,transparent)_1px,transparent_1px),linear-gradient(to_bottom,color-mix(in_oklch,var(--border)_70%,transparent)_1px,transparent_1px)] bg-[size:24px_24px]";

/**
 * The handwriting layout for one Card's Front. `kept` is the scale the User
 * last chose for a Front, which the next Card's starts at; `onKeep` hears each
 * new one.
 */
export function HandwritingShell({
  front,
  kept,
  onKeep,
}: {
  front: string;
  kept: number | null;
  onKeep: (scale: number) => void;
}) {
  const [canvasRef, canvas] = useSize<HTMLDivElement>();
  const [selected, setSelected] = useState(false);
  return (
    <div
      ref={canvasRef}
      data-handwriting
      // The page never scrolls or zooms under it: the canvas will be a viewport of its own.
      className="relative min-h-0 flex-1 touch-none overflow-hidden overscroll-none bg-card"
      onPointerDown={() => setSelected(false)}
    >
      <div role="img" aria-label="Handwritten answer" className={cn("absolute inset-0", GRID)} />
      <FrontOnPaper
        front={front}
        canvas={canvas}
        kept={kept}
        onKeep={onKeep}
        selected={selected}
        onSelect={setSelected}
      />
      <div className="pointer-events-none absolute inset-y-0 right-2 flex items-center lg:right-4">
        <ToolBar />
      </div>
      <ZoomControl />
    </div>
  );
}

function FrontOnPaper({
  front,
  canvas,
  kept,
  onKeep,
  selected,
  onSelect,
}: {
  front: string;
  canvas: { w: number; h: number };
  kept: number | null;
  onKeep: (scale: number) => void;
  selected: boolean;
  onSelect: (selected: boolean) => void;
}) {
  const [measureRef, measured] = useSize<HTMLDivElement>();
  const [at, setAt] = useState<{ x: number; y: number }>(FRONT_AT);
  // Its own scale once the User scales it; until then it starts as `startScale` says.
  const [own, setOwn] = useState<number | null>(null);
  const [lifted, setLifted] = useState(false);

  const base = frontWidth(canvas.w);
  const scale = own ?? startScale({ natural: measured.h, canvasHeight: canvas.h, kept: kept });
  const width = base * scale;
  const height = measured.h * scale;

  const scaleTo = (next: number) => {
    const s = clamp(next, FRONT_SCALE.min, FRONT_SCALE.max);
    setOwn(s);
    onKeep(s);
  };
  const moveTo = (to: { x: number; y: number }) => setAt(keepOnCanvas(to, canvas));

  const from = useRef({ at, scale, width, height });
  const begin = () => {
    from.current = { at, scale, width, height };
    setLifted(true);
  };
  const end = () => setLifted(false);

  const move = useDrag(
    (dx, dy) => moveTo({ x: from.current.at.x + dx, y: from.current.at.y + dy }),
    begin,
    end,
  );
  const corner = useRef<Corner>("br");
  const cornerDrag = useDrag(
    (dx, dy) => {
      const f = from.current;
      const to = scaleFromCorner({ ...f.at, ...f }, corner.current, dx, dy);
      moveTo(to);
      scaleTo(to.scale);
    },
    begin,
    end,
  );

  const onKey = (event: KeyboardEvent) => {
    const step = event.shiftKey ? 40 : 8;
    const by: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const d = by[event.key];
    const scaled =
      event.key === "+" || event.key === "="
        ? scale * 1.1
        : event.key === "-"
          ? scale / 1.1
          : event.key === "0"
            ? 1
            : undefined;
    if (d !== undefined) moveTo({ x: at.x + d[0], y: at.y + d[1] });
    else if (scaled !== undefined) scaleTo(scaled);
    else return;
    event.preventDefault();
  };

  return (
    <section
      aria-label="Front"
      aria-roledescription="movable note"
      aria-describedby="front-moves"
      // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- it moves and scales from the keyboard too
      tabIndex={0}
      style={{ left: at.x, top: at.y, width }}
      onFocus={() => onSelect(true)}
      onKeyDown={onKey}
      className={cn(
        "group/front absolute touch-none outline-none select-none",
        lifted ? "cursor-grabbing" : "cursor-grab",
      )}
      {...move}
      onPointerDown={(event) => {
        onSelect(true);
        move.onPointerDown(event);
      }}
    >
      <span id="front-moves" className="sr-only">
        Drag it to move it, or a corner to scale it. Arrow keys move it; plus and minus scale it,
        and 0 sets it back to 100%.
      </span>
      <div
        className={cn(
          "overflow-hidden rounded-lg bg-background shadow-[0_1px_2px_rgb(0_0_0/0.08),0_8px_24px_-12px_rgb(0_0_0/0.25)] ring-1 ring-border transition-shadow motion-reduce:transition-none",
          lifted && "shadow-[0_2px_4px_rgb(0_0_0/0.1),0_20px_44px_-16px_rgb(0_0_0/0.45)]",
          !selected && "group-hover/front:ring-2 group-hover/front:ring-primary/40",
        )}
      >
        {/* Drawn at its scale, so the type, the Formulas and the Image grow and shrink together. */}
        <div data-front-scale={scale} style={{ zoom: scale, width: base }} className={FRONT_BOX}>
          <CardText text={front} className={FRONT_TEXT} />
        </div>
      </div>
      {/* An unseen copy at 100%, to measure how tall all of it is. */}
      <div
        ref={measureRef}
        data-front-measure
        aria-hidden
        style={{ width: base }}
        className={cn("pointer-events-none invisible absolute top-0 left-0 -z-10", FRONT_BOX)}
      >
        <CardText text={front} className={FRONT_TEXT} />
      </div>
      {selected ? (
        <>
          <span
            aria-hidden
            className="pointer-events-none absolute -inset-[3px] rounded-[0.6rem] border-2 border-primary"
          />
          {CORNERS.map((c) => (
            <Handle
              key={c}
              className={CORNER_AT[c]}
              drag={{
                ...cornerDrag,
                onPointerDown: (event) => {
                  corner.current = c;
                  cornerDrag.onPointerDown(event);
                },
              }}
            />
          ))}
        </>
      ) : (
        <span
          aria-hidden
          className="pointer-events-none absolute -top-6 left-0 text-[0.6875rem] font-medium tracking-wide text-muted-foreground uppercase"
        >
          Front
        </span>
      )}
    </section>
  );
}

const FRONT_BOX = "px-5 pt-4 pb-5";

const FRONT_TEXT =
  "text-lg leading-snug font-medium tracking-[-0.01em] lg:text-xl [&_.katex-display]:overflow-x-auto [&_.katex-display]:overflow-y-hidden [&_img]:pointer-events-none [&_img]:max-h-48 [&_img]:max-w-full [&_img]:rounded-md";

const CORNERS: readonly Corner[] = ["tl", "tr", "bl", "br"];

const CORNER_AT: Record<Corner, string> = {
  tl: "-top-[22px] -left-[22px] cursor-nwse-resize lg:-top-3 lg:-left-3",
  tr: "-top-[22px] -right-[22px] cursor-nesw-resize lg:-top-3 lg:-right-3",
  bl: "-bottom-[22px] -left-[22px] cursor-nesw-resize lg:-bottom-3 lg:-left-3",
  br: "-right-[22px] -bottom-[22px] cursor-nwse-resize lg:-right-3 lg:-bottom-3",
};

/** A corner's handle: small to see, 44 px to touch below 1024 px. */
function Handle({ drag, className }: { drag: Drag; className: string }) {
  return (
    <span
      {...drag}
      aria-hidden
      data-corner
      title="Drag to scale"
      className={cn(
        "absolute z-10 flex size-11 touch-none items-center justify-center lg:size-6",
        className,
      )}
    >
      <span className="size-3.5 rounded-full border-2 border-primary bg-background shadow-sm lg:size-3" />
    </span>
  );
}

const TOOL =
  "flex size-11 shrink-0 items-center justify-center rounded-full text-foreground outline-none transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-40 aria-pressed:bg-primary/10 aria-pressed:text-primary lg:size-9";

/** The pen's thicknesses, finest first, and how large each one's dot is drawn. */
const THICKNESSES = [
  { name: "Fine", dot: 6 },
  { name: "Medium", dot: 8 },
  { name: "Bold", dot: 11 },
] as const;

/** Pen (with its thickness), eraser, undo, redo and clear, in a column: disabled until there is ink. */
function ToolBar() {
  return (
    <div
      role="toolbar"
      aria-label="Handwriting tools"
      aria-orientation="vertical"
      className="pointer-events-auto flex flex-col items-center gap-0.5 rounded-full border bg-background/95 p-1 shadow-sm backdrop-blur"
    >
      <button type="button" aria-label="Pen" aria-pressed disabled className={TOOL}>
        <PenLine aria-hidden className="size-[1.15rem]" />
      </button>
      <div role="radiogroup" aria-label="Pen thickness" className="flex flex-col items-center">
        {THICKNESSES.map((t) => (
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a swatch, not a form's radio
          <button
            key={t.name}
            type="button"
            role="radio"
            aria-checked={t.name === "Medium"}
            aria-label={t.name}
            disabled
            className={cn(TOOL, "h-8 w-11 lg:h-7 lg:w-9")}
          >
            <span
              aria-hidden
              className={cn(
                "rounded-full bg-current",
                t.name === "Medium" ? "text-primary" : "text-muted-foreground",
              )}
              style={{ width: t.dot, height: t.dot }}
            />
          </button>
        ))}
      </div>
      <button type="button" aria-label="Eraser" aria-pressed={false} disabled className={TOOL}>
        <Eraser aria-hidden className="size-[1.15rem]" />
      </button>
      <span aria-hidden className="mx-auto h-px w-6 bg-border" />
      <button type="button" aria-label="Undo stroke" disabled className={TOOL}>
        <Undo2 aria-hidden className="size-[1.15rem]" />
      </button>
      <button type="button" aria-label="Redo stroke" disabled className={TOOL}>
        <Redo2 aria-hidden className="size-[1.15rem]" />
      </button>
      <button type="button" aria-label="Clear" disabled className={TOOL}>
        <Trash2 aria-hidden className="size-[1.15rem]" />
      </button>
    </div>
  );
}

const ZOOM_BUTTON =
  "flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-full px-3 text-sm font-medium text-foreground outline-none hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-40 lg:h-8 lg:min-w-8 lg:px-2.5";

/** − / the zoom / + / Fit, at the bottom-left: disabled until the canvas zooms. */
function ZoomControl() {
  return (
    <div
      role="group"
      aria-label="Zoom"
      className="absolute bottom-3 left-3 flex items-center gap-0.5 rounded-full border bg-background/95 p-1 shadow-sm backdrop-blur"
    >
      <button type="button" aria-label="Zoom out" disabled className={ZOOM_BUTTON}>
        <Minus aria-hidden className="size-4" />
      </button>
      <button
        type="button"
        aria-label="Zoom 100%"
        disabled
        className={cn(ZOOM_BUTTON, "w-16 tabular-nums lg:w-14")}
      >
        100%
      </button>
      <button type="button" aria-label="Zoom in" disabled className={ZOOM_BUTTON}>
        <Plus aria-hidden className="size-4" />
      </button>
      <span aria-hidden className="mx-0.5 h-6 w-px bg-border" />
      <button type="button" aria-label="Fit" disabled className={ZOOM_BUTTON}>
        <ScanSearch aria-hidden className="size-4" />
        Fit
      </button>
    </div>
  );
}

/** The size of the element it's given, kept up to date. */
function useSize<T extends HTMLElement>() {
  const [el, ref] = useState<T | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    if (el === null) return () => {};
    const measure = () => setSize({ w: el.offsetWidth, h: el.offsetHeight });
    measure();
    if (typeof ResizeObserver === "undefined") return () => {};
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [el]);
  return [ref, size] as const;
}

/**
 * Pointer handlers for a drag, by pen, mouse or finger: `move` gets the
 * distance from where it started. It keeps the press to itself, so the paper
 * under it doesn't take it as a tap.
 */
function useDrag(move: (dx: number, dy: number) => void, start: () => void, end: () => void) {
  const from = useRef<{ id: number; x: number; y: number } | null>(null);
  const handlers = useRef({ move, start, end });
  useLayoutEffect(() => {
    handlers.current = { move, start, end };
  });
  const stop = (event: PointerEvent) => {
    if (from.current?.id !== event.pointerId) return;
    from.current = null;
    handlers.current.end();
  };
  return {
    onPointerDown: (event: PointerEvent) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      from.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
      handlers.current.start();
    },
    onPointerMove: (event: PointerEvent) => {
      const f = from.current;
      if (f?.id !== event.pointerId) return;
      handlers.current.move(event.clientX - f.x, event.clientY - f.y);
    },
    onPointerUp: stop,
    onPointerCancel: stop,
  };
}
type Drag = ReturnType<typeof useDrag>;
