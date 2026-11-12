import { ChevronUp, LocateFixed, Maximize, Minus, Plus, ScanSearch } from "lucide-react";
import { type KeyboardEvent, type PointerEvent, useRef, useState } from "react";
import { FoldedNote } from "@/components/study/handwriting-note";
import {
  type Corner,
  FrontObject,
  MENU_BUTTON,
  type Side,
} from "@/components/study/handwriting-object";
import {
  type Board,
  BOARD_ZOOM,
  clamp,
  type Handwriting,
  type Ink,
  InkCanvas,
  ToolBar,
  useDrag,
  useInk,
  useNoteFrame,
  useSize,
} from "@/components/study/handwriting-proto";
import { cn } from "@/lib/utils";

// PROTOTYPE (BAN-45), round 3, from Variant f ("Sticker"): the full-screen grid
// canvas, with the Front stuck on the paper, so it pans with the ink. Here it
// behaves like an image on a Miro board: tap it to select it, drag anywhere on
// it to move it, pull a corner to scale it. The three Variants differ in what
// else the board does:
//
// - g, "Picture": the Front shows whole, like a picture. A long one starts
//   scaled down to fit, and a wheel over it pans the paper like anywhere else.
// - h, "Board": g, and the whole board zooms: two fingers pinch, Ctrl+wheel,
//   or − / + / Fit in a corner, so the Front and the ink grow and shrink
//   together, as on a Miro board.
// - i, "Frame": the sides' handles change its width (the text reflows) and its
//   height (a long Front scrolls inside it), while the corners scale it.
const VARIANT = { zoom: false, frame: false };

/** The smallest and largest the Front scales to, on the paper. */
const SCALE = { min: 0.4, max: 2.5 } as const;
/** A long Front starts scaled to at most this share of the canvas's height (g, h). */
const FIT_SHARE = 0.6;

type Frame = {
  x: number;
  y: number;
  /** Its own scale, or `null` before it has one. */
  scale: number | null;
  /** How wide its text is at 100% (i). */
  base: number | null;
  /** How tall its frame is at 100%, or `null` for the default (i). */
  height: number | null;
  folded: boolean;
};

export function HandwritingView({ hw }: { hw: Handwriting }) {
  const ink = useInk(hw.state === "ink-written");
  // Per Card: the Front is on this Card's paper.
  const [frame, setFrame] = useState<Frame>({
    x: 12,
    y: 28,
    scale: null,
    base: null,
    height: null,
    folded: false,
  });
  const [kept, setKept] = useNoteFrame<{ scale: number | null }>(
    VARIANT.zoom ? "h" : VARIANT.frame ? "i" : "g",
    { scale: null },
  );
  const [selected, setSelected] = useState(false);
  const [lifted, setLifted] = useState(false);
  const [measureRef, measured] = useSize<HTMLDivElement>();
  const [areaRef, area] = useSize<HTMLDivElement>();

  return (
    <InkCanvas
      ink={ink}
      paper="grid"
      sample={hw.state === "ink-written"}
      className="flex-1 bg-card"
      zoomable={VARIANT.zoom}
      onPaperDown={() => setSelected(false)}
      renderOnPaper={(board) => (
        <OnPaper
          board={board}
          ink={ink}
          front={hw.front}
          frame={frame}
          setFrame={setFrame}
          kept={kept.scale}
          keep={(scale) => setKept({ scale })}
          selected={selected}
          setSelected={setSelected}
          lifted={lifted}
          setLifted={setLifted}
          measureRef={measureRef}
          naturalHeight={measured.h}
          area={area}
        />
      )}
    >
      <div ref={areaRef} className="pointer-events-none absolute inset-0" />
      <div className="pointer-events-none absolute inset-y-0 right-2 flex items-center lg:right-4">
        <ToolBar
          ink={ink}
          vertical
          className="pointer-events-auto rounded-full border bg-background/95 p-1 shadow-sm backdrop-blur"
        />
      </div>
    </InkCanvas>
  );
}

function OnPaper({
  board,
  ink,
  front,
  frame,
  setFrame,
  kept,
  keep,
  selected,
  setSelected,
  lifted,
  setLifted,
  measureRef,
  naturalHeight,
  area,
}: {
  board: Board;
  ink: Ink;
  front: string;
  frame: Frame;
  setFrame: (update: (frame: Frame) => Frame) => void;
  kept: number | null;
  keep: (scale: number) => void;
  selected: boolean;
  setSelected: (selected: boolean) => void;
  lifted: boolean;
  setLifted: (lifted: boolean) => void;
  measureRef: (el: HTMLDivElement | null) => void;
  naturalHeight: number;
  area: { w: number; h: number };
}) {
  const zoom = board.zoom;
  const wide = area.w >= 1000;
  const base = frame.base ?? (wide ? 416 : Math.max(240, area.w - 24 - 56));
  // How tall all of the Front is at 100%.
  const natural = naturalHeight;
  const fit =
    !VARIANT.frame && natural > 0 && area.h > 0 ? (area.h * FIT_SHARE) / (natural * zoom) : 1;
  const scale = clamp(frame.scale ?? Math.min(kept ?? 1, fit), SCALE.min, SCALE.max);
  const shown = scale * zoom;
  const width = base * shown;
  // i: a frame of its own height; by default, at most 45% of the canvas, as in f.
  const frameHeight = VARIANT.frame
    ? frame.height === null
      ? Math.max(96, area.h * 0.45)
      : frame.height * shown
    : null;
  const height =
    frameHeight === null || natural === 0 ? null : Math.min(frameHeight, natural * shown);
  const fullHeight = natural * shown;
  const onScreenHeight = height ?? fullHeight;
  const cut = height !== null && height < fullHeight - 1;

  const left = (frame.x - board.x) * zoom;
  const top = (frame.y - board.y) * zoom;

  const from = useRef({ frame, scale, width, height: onScreenHeight, natural });
  const begin = () => {
    from.current = {
      frame: { ...frame, scale, base },
      scale,
      width,
      height: onScreenHeight,
      natural,
    };
    setLifted(true);
  };
  const end = () => setLifted(false);

  const move = useDrag(
    (dx, dy) =>
      setFrame((f) => ({
        ...f,
        x: Math.max(0, from.current.frame.x + dx / zoom),
        y: Math.max(0, from.current.frame.y + dy / zoom),
      })),
    end,
    begin,
  );
  const scaleTo = (next: number) => {
    const s = clamp(next, SCALE.min, SCALE.max);
    setFrame((f) => ({ ...f, scale: s }));
    keep(s);
  };

  // One drag for the four corners: the one pressed says which way it grows.
  const which = useRef<Corner>("br");
  const cornerDrag = useDrag(
    (dx, dy) => {
      const corner = which.current;
      const f = from.current;
      const sx = corner.endsWith("r") ? 1 : -1;
      const sy = corner.startsWith("b") ? 1 : -1;
      const rx = (f.width + sx * dx) / f.width;
      const ry = f.height > 0 ? (f.height + sy * dy) / f.height : rx;
      const r = Math.abs(rx - 1) >= Math.abs(ry - 1) ? rx : ry;
      const s = clamp(f.scale * r, SCALE.min, SCALE.max);
      const done = s / f.scale;
      setFrame((g) => ({
        ...g,
        scale: s,
        x: sx < 0 ? Math.max(0, f.frame.x + (f.width - f.width * done) / zoom) : g.x,
        y: sy < 0 ? Math.max(0, f.frame.y + (f.height - f.height * done) / zoom) : g.y,
      }));
      keep(s);
    },
    end,
    begin,
  );
  const corner = (c: Corner) => ({
    ...cornerDrag,
    onPointerDown: (event: PointerEvent) => {
      which.current = c;
      cornerDrag.onPointerDown(event);
    },
  });

  const right = useDrag(
    (dx) => {
      const f = from.current;
      const atScale = f.scale * zoom;
      setFrame((g) => ({
        ...g,
        base: clamp((f.frame.base ?? base) + dx / atScale, 200, 960),
      }));
    },
    end,
    begin,
  );
  const bottom = useDrag(
    (_dx, dy) => {
      const f = from.current;
      const atScale = f.scale * zoom;
      setFrame((g) => ({
        ...g,
        height: clamp((f.height + dy) / atScale, 80, Math.max(80, f.natural)),
      }));
    },
    end,
    begin,
  );
  const sides: Record<Side, ReturnType<typeof useDrag>> = { r: right, b: bottom };

  const onKey = (event: KeyboardEvent) => {
    const step = (event.shiftKey ? 40 : 8) / zoom;
    const by: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const d = by[event.key];
    if (d !== undefined) {
      event.preventDefault();
      setFrame((f) => ({ ...f, x: Math.max(0, f.x + d[0]), y: Math.max(0, f.y + d[1]) }));
    } else if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      scaleTo(scale * 1.1);
    } else if (event.key === "-") {
      event.preventDefault();
      scaleTo(scale / 1.1);
    } else if (event.key === "0") {
      event.preventDefault();
      scaleTo(1);
    }
  };

  const h = frame.folded ? 44 : onScreenHeight;
  const w = frame.folded ? 200 : width;
  const away =
    area.w > 0 && (left + w < 24 || top + h < 24 || left > area.w - 24 || top > area.h - 24);

  const fitAll = () => {
    const rect = { x: frame.x, y: frame.y - 28 / zoom, w: width / zoom, h: h / zoom + 28 / zoom };
    let r = rect.x + rect.w;
    let b = rect.y + rect.h;
    let l = rect.x;
    let t = rect.y;
    for (const s of ink.strokes)
      for (const p of s.points) {
        l = Math.min(l, p.x);
        t = Math.min(t, p.y);
        r = Math.max(r, p.x);
        b = Math.max(b, p.y);
      }
    board.fit({ x: l, y: t, w: r - l, h: b - t });
  };

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {area.w > 0 &&
        (frame.folded ? (
          <FoldedNote
            front={front}
            onOpen={() => setFrame((f) => ({ ...f, folded: false }))}
            style={{ left, top }}
          />
        ) : (
          <FrontObject
            front={front}
            scale={shown}
            width={width}
            height={height}
            selected={selected}
            lifted={lifted}
            onSelect={() => setSelected(true)}
            move={move}
            corner={corner}
            side={VARIANT.frame ? (s) => sides[s] : undefined}
            onKey={onKey}
            onScaleWheel={
              VARIANT.zoom ? undefined : (deltaY) => scaleTo(scale * Math.exp(-deltaY * 0.01))
            }
            measureRef={measureRef}
            base={base}
            menuBelow={top < 72}
            style={{ left, top }}
            menu={
              <>
                <button
                  type="button"
                  title="Back to 100%"
                  disabled={Math.abs(scale - 1) < 0.005}
                  onClick={() => scaleTo(1)}
                  className={cn(MENU_BUTTON, "tabular-nums")}
                >
                  {Math.round(scale * 100)}%
                </button>
                {VARIANT.frame && cut && (
                  <button
                    type="button"
                    onClick={() => setFrame((f) => ({ ...f, height: 100000 }))}
                    className={MENU_BUTTON}
                  >
                    <Maximize aria-hidden className="size-4" />
                    Show all
                  </button>
                )}
                <span aria-hidden className="mx-0.5 h-6 w-px bg-border" />
                <button
                  type="button"
                  onClick={() => {
                    setSelected(false);
                    setFrame((f) => ({ ...f, folded: true }));
                  }}
                  className={MENU_BUTTON}
                >
                  <ChevronUp aria-hidden className="size-4" />
                  Fold away
                </button>
              </>
            }
          />
        ))}
      {away && (
        <button
          type="button"
          onClick={() =>
            setFrame((f) => ({ ...f, x: board.x + 12 / zoom, y: board.y + 28 / zoom }))
          }
          className="pointer-events-auto absolute top-3 left-3 flex h-11 items-center gap-2 rounded-full border bg-background/95 pr-4 pl-3 text-sm font-medium shadow-sm backdrop-blur outline-none hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring lg:h-9"
        >
          <LocateFixed aria-hidden className="size-4 text-primary" />
          Bring the Front here
        </button>
      )}
      {VARIANT.zoom && (
        <div
          role="group"
          aria-label="Zoom"
          className="pointer-events-auto absolute bottom-3 left-3 flex items-center gap-0.5 rounded-full border bg-background/95 p-1 shadow-sm backdrop-blur"
        >
          <button
            type="button"
            aria-label="Zoom out"
            disabled={zoom <= BOARD_ZOOM.min + 0.001}
            onClick={() => board.zoomTo(zoom / 1.25)}
            className={MENU_BUTTON}
          >
            <Minus aria-hidden className="size-4" />
          </button>
          <button
            type="button"
            title="Back to 100%"
            onClick={() => board.zoomTo(1)}
            className={cn(MENU_BUTTON, "w-16 tabular-nums lg:w-14")}
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            aria-label="Zoom in"
            disabled={zoom >= BOARD_ZOOM.max - 0.001}
            onClick={() => board.zoomTo(zoom * 1.25)}
            className={MENU_BUTTON}
          >
            <Plus aria-hidden className="size-4" />
          </button>
          <span aria-hidden className="mx-0.5 h-6 w-px bg-border" />
          <button
            type="button"
            onClick={fitAll}
            className={MENU_BUTTON}
            title="Fit the Front and the ink"
          >
            <ScanSearch aria-hidden className="size-4" />
            Fit
          </button>
        </div>
      )}
    </div>
  );
}
