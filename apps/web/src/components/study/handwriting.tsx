import { Eraser, Minus, PenLine, Plus, Redo2, ScanSearch, Trash2, Undo2 } from "lucide-react";
import {
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type RefObject,
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { flushSync } from "react-dom";
import { CardText } from "@/components/cards/card-text";
import {
  type Corner,
  FRONT_AT,
  FRONT_SCALE,
  clamp,
  frontWidth,
  scaleFromCorner,
  startScale,
} from "@/lib/handwriting";
import {
  GRID_SIZE,
  INK_SIZE,
  type InkPoint,
  type Point,
  type Rect,
  START_VIEW,
  type Stroke,
  type View,
  ZOOM,
  fit,
  gridLines,
  gridOpacity,
  inkBounds,
  outlinePath,
  panBy,
  penSamples,
  pinch,
  restZoom,
  strokeOutline,
  strokePath,
  union,
  viewTransform,
  wheelPan,
  wheelPixels,
  wheelZoom,
  zoomAbout,
  zoomStep,
} from "@/lib/ink";
import { cn } from "@/lib/utils";

// Handwriting on the study screen ("Bare board", BAN-45; docs/design.md §
// Handwriting): in write-and-grade before Check, the Canvas takes the whole
// screen between the top bar and the dock, on grid paper, and the Front sits
// on it like an image on a board. The tool bar stands at the right edge, and
// the zoom control at the bottom-left.
//
// The stylus writes Ink, anywhere, over the Front too, and does nothing else.
// Fingers and the mouse navigate: one finger, a mouse drag or the wheel pans,
// two fingers pinch, and Ctrl/⌘ with the wheel zooms. A tap selects the
// Front; selected, a drag moves it and its corners scale it. While the pen is
// down every touch is a palm, ignored until it lifts.
//
// Drawing follows ADR-0036: the Stroke being written goes on a viewport-sized
// <canvas>, drawn in the frame its samples arrive in, with no React render;
// when the pen lifts it becomes an SVG path in the layer that holds the
// Front, and panning or zooming changes only that layer's transform. Once the
// view rests zoomed in, the layer is laid out at its zoom (CSS `zoom`), so the
// browser draws it crisp rather than enlarging what it drew at 100%. The
// pointers' state lives in a ref, never in React state.
//
// The tools and Check wait for BAN-47 and BAN-106.

/** How strong the grid's lines are, over the hairline colour. */
const GRID_ALPHA = 0.7;

/** How long after the view last moved the Front's layer is drawn afresh, crisp at its zoom. */
const SETTLE_MS = 200;

/** How far a finger or the mouse may move and still be a tap. */
const TAP_SLOP = 8;

/**
 * The handwriting layout for one Card's Front. `kept` is the scale the User
 * last chose for a Front, which the next Card's starts at; `onKeep` hears each
 * new one. `strokes` is the Card's Ink, which the study screen keeps;
 * `onStrokes` hears it with each new Stroke.
 */
export function HandwritingShell({
  front,
  kept,
  onKeep,
  strokes,
  onStrokes,
}: {
  front: string;
  kept: number | null;
  onKeep: (scale: number) => void;
  strokes: readonly Stroke[];
  onStrokes: (strokes: Stroke[]) => void;
}) {
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  const canvas = useSize(viewport);
  const [selected, setSelected] = useState(false);
  const [nav] = useState(() => new Navigator());
  const world = useRef<HTMLDivElement>(null);
  const drawn = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLCanvasElement>(null);
  const live = useRef<HTMLCanvasElement>(null);
  const ink = useRef<SVGSVGElement>(null);
  const frontBox = useRef<Rect | null>(null);

  const latest = useRef({ strokes, onStrokes });
  useLayoutEffect(() => {
    latest.current = { strokes, onStrokes };
  });

  // The pointers and the view, wired once to the elements they move.
  useLayoutEffect(() => {
    nav.attach({
      viewport,
      world: world.current,
      drawn: drawn.current,
      grid: grid.current,
      live: live.current,
      ink: ink.current,
      onStroke: (stroke) => {
        const { strokes: all, onStrokes: hear } = latest.current;
        // The path is in the DOM before the live canvas clears, in one frame.
        flushSync(() => hear([...all, stroke]));
      },
      onTap: setSelected,
    });
    return () => nav.detach();
  }, [nav, viewport, setSelected]);

  useLayoutEffect(() => nav.resize(canvas), [nav, canvas]);

  // Fit keeps what it frames clear of the tool bar at the right and the zoom control at the bottom.
  const fitAll = () => {
    const content = union([frontBox.current, inkBounds(latest.current.strokes)]);
    if (content === null || canvas.w <= 0 || viewport === null) return;
    const box = viewport.getBoundingClientRect();
    const tools = viewport.querySelector("[data-tools]")?.getBoundingClientRect();
    const zoom = viewport.querySelector("[data-zoom]")?.getBoundingClientRect();
    const clear = {
      right: tools !== undefined && tools.width > 0 ? Math.max(0, box.right - tools.left) : 0,
      bottom: zoom !== undefined && zoom.height > 0 ? Math.max(0, box.bottom - zoom.top) : 0,
    };
    nav.show(fit(content, canvas, clear));
  };

  return (
    <div
      ref={setViewport}
      data-handwriting
      // The page never scrolls, zooms or selects under it: the Canvas is a viewport of its own.
      className="relative min-h-0 flex-1 touch-none overflow-hidden overscroll-none bg-card select-none [-webkit-touch-callout:none] [-webkit-user-select:none]"
      onPointerDownCapture={nav.downCapture}
      onPointerDown={nav.down}
      onPointerMove={nav.move}
      onPointerUpCapture={nav.up}
      onPointerCancelCapture={nav.cancel}
      onLostPointerCapture={nav.lost}
      onClickCapture={nav.click}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div role="img" aria-label="Handwritten answer" className="absolute inset-0">
        {/* The paper's grid, drawn by the view in the frame it moves, on whole device pixels. */}
        <canvas
          ref={grid}
          data-grid
          aria-hidden
          className="absolute inset-0 size-full text-border"
        />
      </div>
      <div ref={world} data-canvas-layer className="absolute top-0 left-0 origin-top-left">
        {/* Laid out at the zoom the view last rested at, which the layer's transform scales from. */}
        <div ref={drawn} data-canvas-zoom className="absolute top-0 left-0">
          <FrontOnPaper
            front={front}
            canvas={canvas}
            kept={kept}
            onKeep={onKeep}
            selected={selected}
            onSelect={setSelected}
            nav={nav}
            onBox={(box) => void (frontBox.current = box)}
          />
          <Ink ref={ink} strokes={strokes} />
        </div>
      </div>
      <canvas
        ref={live}
        data-live-ink
        aria-hidden
        className="pointer-events-none absolute inset-0 size-full"
      />
      <div
        data-chrome
        data-tools
        className="pointer-events-none absolute inset-y-0 right-2 flex items-center lg:right-4"
      >
        <ToolBar />
      </div>
      <ZoomControl nav={nav} onFit={fitAll} />
    </div>
  );
}

/** The finished Ink: one SVG path per Stroke, over the Front, in its layer. */
function Ink({
  ref,
  strokes,
}: {
  ref: RefObject<SVGSVGElement | null>;
  strokes: readonly Stroke[];
}) {
  // As large as the Ink, so no browser clips or skips what it draws past its box.
  const box = useMemo(() => inkBounds(strokes) ?? { x: 0, y: 0, w: 1, h: 1 }, [strokes]);
  return (
    <svg
      ref={ref}
      aria-hidden
      data-ink
      data-strokes={strokes.length}
      width={box.w}
      height={box.h}
      viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
      style={{ left: box.x, top: box.y }}
      className="pointer-events-none absolute overflow-visible text-foreground"
    >
      {strokes.map((stroke, i) => (
        // Strokes are only ever added, so the index is each one's for good.
        // oxlint-disable-next-line react/no-array-index-key
        <InkPath key={i} stroke={stroke} />
      ))}
    </svg>
  );
}

/** One Stroke's path, worked out once. */
const InkPath = memo(function InkPath({ stroke }: { stroke: Stroke }) {
  const d = useMemo(() => strokePath(stroke), [stroke]);
  return <path d={d} fill="currentColor" />;
});

type Elements = {
  viewport: HTMLDivElement | null;
  world: HTMLDivElement | null;
  drawn: HTMLDivElement | null;
  grid: HTMLCanvasElement | null;
  live: HTMLCanvasElement | null;
  ink: SVGSVGElement | null;
  onStroke: (stroke: Stroke) => void;
  onTap: (onFront: boolean) => void;
};

type Gesture =
  | { kind: "pan"; id: number; start: Point; last: Point; moved: boolean; onFront: boolean }
  | { kind: "pinch"; ids: [number, number]; from: [Point, Point]; view: View };

/** Whether the browser lays an element out at its CSS `zoom`. */
function cssZoom(): boolean {
  return typeof CSS !== "undefined" && CSS.supports("zoom", "2");
}

/** The Front's measure stays at 100%, whatever the layer is laid out at. */
function measureZoom(drawnAt: number): string {
  return drawnAt === 1 ? "" : String(1 / drawnAt);
}

/** Whether a pen's pointer event writes: its tip, with neither its eraser end nor its barrel button. */
function writes(event: PointerEvent): boolean {
  return event.button === 0 && (event.buttons & ~1) === 0;
}

/** Whether a pointer event is on the tool bar or the zoom control, which take it themselves. */
function onChrome(event: PointerEvent): boolean {
  return event.target instanceof Element && event.target.closest("[data-chrome]") !== null;
}

/**
 * The Canvas's pointers and its view, outside React: the Stroke being
 * written, the touches and the mouse that are down, which of them are palms,
 * the pan or pinch under way, and where the view is. It moves the layers
 * itself, and tells React only of a finished Stroke, a tap, and the zoom.
 */
class Navigator {
  view: View = START_VIEW;
  /** The zoom the layer is laid out at (its CSS `zoom`): the one the view last rested at, zoomed in. */
  drawnAt = 1;
  private el: Elements | null = null;
  private size = { w: 0, h: 0 };
  /** Every touch and mouse pointer that is down, where it is on screen, and whether on the controls. */
  private pointers = new Map<number, { type: string; at: Point; chrome: boolean }>();
  /** Touches that were down while the pen was: palms, until they lift. */
  private palms = new Set<number>();
  /** Palms just lifted, whose clicks on the controls never count. */
  private liftedPalms = new Set<number>();
  private gesture: Gesture | null = null;
  private pen: { id: number; stroke: Stroke; ahead: InkPoint[]; color: string } | null = null;
  private frame: number | null = null;
  private context: CanvasRenderingContext2D | null = null;
  private gridContext: CanvasRenderingContext2D | null = null;
  private settle: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<() => void>();
  private safariZoom: View | null = null;

  attach(el: Elements) {
    this.el = el;
    this.context = null;
    try {
      // The live canvas's context, low-latency where the browser takes it.
      this.context = el.live?.getContext("2d", { desynchronized: true }) ?? null;
    } catch {
      this.context = null;
    }
    this.gridContext = null;
    try {
      this.gridContext = el.grid?.getContext("2d") ?? null;
    } catch {
      this.gridContext = null;
    }
    this.apply(this.view);
    const viewport = el.viewport;
    if (viewport === null) return;
    // Native, so they can stop the page's own scroll and zoom.
    const wheel = (event: WheelEvent) => this.wheel(event);
    const gesture = (event: Event) => this.safariGesture(event);
    viewport.addEventListener("wheel", wheel, { passive: false });
    for (const type of ["gesturestart", "gesturechange", "gestureend"]) {
      viewport.addEventListener(type, gesture, { passive: false });
    }
    // A pen whose lift the window never hears, as it loses the focus, ends its Stroke there.
    const blur = () => this.finish();
    window.addEventListener("blur", blur);
    // The grid's colour is the theme's: drawn again when the theme changes.
    const theme = () => this.drawGrid();
    const themes = typeof MutationObserver === "undefined" ? null : new MutationObserver(theme);
    themes?.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });
    const scheme = window.matchMedia?.("(prefers-color-scheme: dark)");
    scheme?.addEventListener?.("change", theme);
    this.detachListeners = () => {
      themes?.disconnect();
      scheme?.removeEventListener?.("change", theme);
      window.removeEventListener("blur", blur);
      viewport.removeEventListener("wheel", wheel);
      for (const type of ["gesturestart", "gesturechange", "gestureend"]) {
        viewport.removeEventListener(type, gesture);
      }
    };
  }

  private detachListeners = () => {};

  detach() {
    this.detachListeners();
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    if (this.settle !== null) clearTimeout(this.settle);
    this.settle = null;
    this.el = null;
  }

  /** The viewport's size changed: the live canvas matches it, and the view stays where it is. */
  resize(size: { w: number; h: number }) {
    this.size = size;
    const dpr = window.devicePixelRatio || 1;
    for (const canvas of [this.el?.live, this.el?.grid]) {
      if (canvas == null) continue;
      canvas.width = Math.round(size.w * dpr);
      canvas.height = Math.round(size.h * dpr);
    }
    this.drawGrid();
    this.draw();
  }

  // The zoom, for the zoom control (useSyncExternalStore).
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  zoom = () => this.view.zoom;
  drawnZoom = () => this.drawnAt;

  /**
   * Whether a pointer is a palm, or a finger a pinch has taken: the Front's
   * drags stop at it.
   */
  ignores = (id: number) =>
    this.palms.has(id) ||
    (this.pen !== null && this.pen.id !== id) ||
    (this.gesture?.kind === "pinch" && this.gesture.ids.includes(id));

  // The zoom control's. The view never moves under a Stroke being written,
  // whose samples are in the view they came in.

  /** Moves the view to `view`: only the layer's transform and the grid change. */
  show(view: View) {
    if (this.pen === null) this.apply(view);
  }

  step(by: -1 | 1) {
    this.show(zoomStep(this.view, by, this.size));
  }

  zoomTo(zoom: number) {
    this.show(zoomAbout(this.view, zoom, { x: this.size.w / 2, y: this.size.h / 2 }));
  }

  private apply(view: View) {
    const moved = view.x !== this.view.x || view.y !== this.view.y || view.zoom !== this.view.zoom;
    const zoomed = view.zoom !== this.view.zoom;
    this.view = view;
    const world = this.el?.world;
    if (world != null) {
      world.style.transform = viewTransform(view, this.drawnAt);
      // The corners stay the same size on screen at every zoom.
      for (const corner of world.querySelectorAll<HTMLElement>("[data-corner]")) {
        corner.style.scale = String(1 / view.zoom);
      }
      if (moved) this.navigating(world);
    }
    this.drawGrid();
    if (zoomed) for (const listener of this.listeners) listener();
  }

  /**
   * While the view moves, the compositor moves the Front's layer as it is;
   * once it has rested a moment, the layer is drawn afresh, crisp at its zoom.
   */
  private navigating(world: HTMLDivElement) {
    world.style.willChange = "transform";
    if (this.settle !== null) clearTimeout(this.settle);
    this.settle = setTimeout(() => {
      this.settle = null;
      this.rest(world);
      world.style.willChange = "";
    }, SETTLE_MS);
  }

  /**
   * Lays the layer out at the zoom the view rests at, zoomed in, with its
   * transform scaling by what is left. A browser that composites the layer
   * draws it at its laid-out size and enlarges that picture by the transform:
   * on the iPad, Ink scaled up by the transform alone showed pixelated.
   */
  private rest(world: HTMLDivElement) {
    const drawn = this.el?.drawn;
    if (drawn == null || !cssZoom()) return;
    const at = restZoom(this.view.zoom);
    if (at === this.drawnAt) return;
    this.drawnAt = at;
    // In one go, so no frame shows the new layout under the old transform.
    drawn.style.zoom = at === 1 ? "" : String(at);
    for (const measure of drawn.querySelectorAll<HTMLElement>("[data-front-measure]")) {
      measure.style.zoom = measureZoom(at);
    }
    world.style.transform = viewTransform(this.view, at);
    for (const listener of this.listeners) listener();
  }

  /** The grid, drawn again where the view puts it: whole device pixels, so its lines never shimmer or jump. */
  private drawGrid() {
    const canvas = this.el?.grid;
    const ctx = this.gridContext;
    if (canvas == null) return;
    canvas.style.opacity = String(gridOpacity(this.view.zoom));
    canvas.dataset.cell = String(GRID_SIZE * this.view.zoom);
    if (ctx === null || typeof ctx.fillRect !== "function") return;
    const dpr = window.devicePixelRatio || 1;
    const line = Math.max(1, Math.round(dpr));
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = GRID_ALPHA;
    ctx.fillStyle = getComputedStyle(canvas).color;
    const lines = gridLines(this.view, this.size);
    for (const x of lines.x) ctx.fillRect(Math.round(x * dpr), 0, line, canvas.height);
    for (const y of lines.y) ctx.fillRect(0, Math.round(y * dpr), canvas.width, line);
  }

  /** Where the viewport's top-left is on screen. */
  private origin(): Point {
    const rect = this.el?.viewport?.getBoundingClientRect();
    return { x: rect?.left ?? 0, y: rect?.top ?? 0 };
  }

  private local(event: { clientX: number; clientY: number }): Point {
    const o = this.origin();
    return { x: event.clientX - o.x, y: event.clientY - o.y };
  }

  private capture(event: PointerEvent) {
    try {
      this.el?.viewport?.setPointerCapture(event.pointerId);
    } catch {
      // A pointer the browser no longer has: nothing to capture.
    }
  }

  // The pen first, before the Front sees it: it writes, over the Front too.
  downCapture = (event: PointerEvent) => {
    this.liftedPalms.clear();
    const chrome = onChrome(event);
    if (event.pointerType === "pen") {
      // The pen taps the controls as a finger does.
      if (chrome) return;
      event.preventDefault();
      event.stopPropagation();
      if (this.pen?.id === event.pointerId) return;
      // A Stroke whose lift never came ends where it was.
      this.finish();
      if (!writes(event)) return;
      // A palm already resting, and a pan or pinch under way, stop here.
      for (const [id, p] of this.pointers) if (p.type === "touch") this.palms.add(id);
      this.gesture = null;
      const { kept } = penSamples(event.nativeEvent, this.view, this.origin());
      const ink = this.el?.ink;
      this.pen = {
        id: event.pointerId,
        stroke: { points: kept, size: INK_SIZE.medium },
        ahead: [],
        // The finished Ink's colour: the theme's foreground.
        color: ink ? getComputedStyle(ink).color : "",
      };
      this.capture(event);
      this.schedule();
      return;
    }
    // On the controls too, so a palm there is one.
    this.pointers.set(event.pointerId, { type: event.pointerType, at: this.local(event), chrome });
    if (event.pointerType === "touch" && this.pen !== null) {
      this.palms.add(event.pointerId);
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (!chrome) event.preventDefault();
  };

  // A click from a palm on the controls, or any while the pen writes, does nothing.
  click = (event: MouseEvent) => {
    const id = (event.nativeEvent as Partial<globalThis.PointerEvent>).pointerId;
    if (this.pen === null && (id === undefined || !this.liftedPalms.has(id))) return;
    event.preventDefault();
    event.stopPropagation();
  };

  // A touch or the mouse the Front didn't take: it pans, or with a second finger, pinches.
  down = (event: PointerEvent) => {
    if (onChrome(event) || event.pointerType === "pen") return;
    if (this.ignores(event.pointerId)) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const at = this.local(event);
    const g = this.gesture;
    // A finger already down that no gesture has, such as one moving the Front: with this one, a pinch.
    const other = [...this.pointers].find(
      ([id, p]) => id !== event.pointerId && p.type === "touch" && !p.chrome && !this.palms.has(id),
    );
    if (g === null && event.pointerType === "touch" && other !== undefined) {
      this.gesture = {
        kind: "pinch",
        ids: [other[0], event.pointerId],
        from: [other[1].at, at],
        view: this.view,
      };
    } else if (g === null) {
      const onFront =
        event.target instanceof Element && event.target.closest("[data-front]") !== null;
      this.gesture = {
        kind: "pan",
        id: event.pointerId,
        start: at,
        last: at,
        moved: false,
        onFront,
      };
    } else if (g.kind === "pan" && event.pointerType === "touch") {
      const first = this.pointers.get(g.id);
      if (first?.type !== "touch") return;
      this.gesture = {
        kind: "pinch",
        ids: [g.id, event.pointerId],
        from: [first.at, at],
        view: this.view,
      };
    } else {
      return;
    }
    this.capture(event);
  };

  move = (event: PointerEvent) => {
    const pen = this.pen;
    if (event.pointerType === "pen") {
      if (pen?.id !== event.pointerId) return;
      const { kept, ahead } = penSamples(event.nativeEvent, this.view, this.origin());
      pen.stroke.points.push(...kept);
      pen.ahead = ahead;
      this.schedule();
      return;
    }
    const p = this.pointers.get(event.pointerId);
    if (p === undefined) return;
    p.at = this.local(event);
    if (this.palms.has(event.pointerId)) return;
    const g = this.gesture;
    if (g?.kind === "pan" && g.id === event.pointerId) {
      // Past a tap, it pans by all of the way it came.
      if (Math.hypot(p.at.x - g.start.x, p.at.y - g.start.y) > TAP_SLOP) g.moved = true;
      if (!g.moved) return;
      this.apply(panBy(this.view, p.at.x - g.last.x, p.at.y - g.last.y));
      g.last = p.at;
    } else if (g?.kind === "pinch" && g.ids.includes(event.pointerId)) {
      const a = this.pointers.get(g.ids[0])?.at;
      const b = this.pointers.get(g.ids[1])?.at;
      if (a !== undefined && b !== undefined) this.apply(pinch(g.view, g.from, [a, b]));
    }
  };

  up = (event: PointerEvent) => this.lift(event, true);
  cancel = (event: PointerEvent) => this.lift(event, false);

  // The pen's capture lost without a lift (the browser dropped it): its Stroke ends there.
  lost = (event: PointerEvent) => {
    if (this.pen?.id === event.pointerId) this.finish();
  };

  /** Ends the Stroke being written, if there is one: it becomes Ink, and the live canvas clears. */
  private finish() {
    const pen = this.pen;
    if (pen === null) return;
    this.pen = null;
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.el?.onStroke(pen.stroke);
    this.clear();
  }

  private lift(event: PointerEvent, lifted: boolean) {
    const pen = this.pen;
    if (pen !== null && pen.id === event.pointerId) {
      // The lift's own samples, past the last move's.
      if (lifted) {
        const last = pen.stroke.points.at(-1);
        for (const point of penSamples(event.nativeEvent, this.view, this.origin()).kept) {
          if (last === undefined || point[0] !== last[0] || point[1] !== last[1]) {
            pen.stroke.points.push([point[0], point[1], last?.[2] ?? point[2]]);
          }
        }
      }
      this.finish();
      return;
    }
    if (!this.pointers.delete(event.pointerId)) return;
    if (this.palms.delete(event.pointerId)) this.liftedPalms.add(event.pointerId);
    const g = this.gesture;
    if (g?.kind === "pan" && g.id === event.pointerId) {
      this.gesture = null;
      if (lifted && !g.moved) this.el?.onTap(g.onFront);
    } else if (g?.kind === "pinch" && g.ids.includes(event.pointerId)) {
      // The finger left behind pans on, from where it is.
      const id = g.ids[0] === event.pointerId ? g.ids[1] : g.ids[0];
      const at = this.pointers.get(id)?.at;
      this.gesture =
        at === undefined
          ? null
          : { kind: "pan", id, start: at, last: at, moved: true, onFront: false };
    }
  }

  private wheel(event: WheelEvent) {
    event.preventDefault();
    if (this.pen !== null) return;
    const page = this.size.h || 800;
    const dx = wheelPixels(event.deltaX, event.deltaMode, page);
    const dy = wheelPixels(event.deltaY, event.deltaMode, page);
    if (event.ctrlKey || event.metaKey) {
      this.apply(zoomAbout(this.view, this.view.zoom * wheelZoom(dy), this.local(event)));
      return;
    }
    const by = wheelPan(dx, dy, event.shiftKey);
    this.apply(panBy(this.view, by.x, by.y));
  }

  /** Safari's trackpad pinch on a Mac, which comes as gesture events, not Ctrl with the wheel. */
  private safariGesture(event: Event) {
    event.preventDefault();
    // A touch screen's pinch is the pointers' already.
    if (this.pen !== null || [...this.pointers.values()].some((p) => p.type === "touch")) return;
    const e = event as Event & { scale?: number; clientX?: number; clientY?: number };
    if (event.type === "gesturestart") this.safariZoom = this.view;
    else if (event.type === "gestureend") this.safariZoom = null;
    else if (this.safariZoom !== null && typeof e.scale === "number") {
      const about = this.local({ clientX: e.clientX ?? 0, clientY: e.clientY ?? 0 });
      this.apply(zoomAbout(this.view, this.safariZoom.zoom * e.scale, about));
    }
  }

  /** Draws the Stroke being written in the next frame, once however many samples come before it. */
  private schedule() {
    if (this.frame !== null) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      this.draw();
    });
  }

  private clear() {
    const ctx = this.context;
    const live = this.el?.live;
    if (ctx === null || live == null) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, live.width, live.height);
  }

  /** The live canvas: cleared, and the Stroke being written drawn again, predicted samples included. */
  private draw() {
    this.clear();
    const ctx = this.context;
    const pen = this.pen;
    if (ctx === null || pen === null || typeof Path2D === "undefined") return;
    const dpr = window.devicePixelRatio || 1;
    const { x, y, zoom } = this.view;
    ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, dpr * x, dpr * y);
    ctx.fillStyle = pen.color;
    // oxlint-disable-next-line unicorn/no-array-fill-with-reference-type -- a canvas's fill, not an array's
    ctx.fill(new Path2D(outlinePath(strokeOutline(pen.stroke, { ahead: pen.ahead }))));
  }
}

function FrontOnPaper({
  front,
  canvas,
  kept,
  onKeep,
  selected,
  onSelect,
  nav,
  onBox,
}: {
  front: string;
  canvas: { w: number; h: number };
  kept: number | null;
  onKeep: (scale: number) => void;
  selected: boolean;
  onSelect: (selected: boolean) => void;
  nav: Navigator;
  /** Hears where it is on the Canvas, for Fit. */
  onBox: (box: Rect) => void;
}) {
  const [measureEl, setMeasureEl] = useState<HTMLDivElement | null>(null);
  const drawnAt = useSyncExternalStore(nav.subscribe, nav.drawnZoom, nav.drawnZoom);
  const measured = useSize(measureEl);
  const [at, setAt] = useState<{ x: number; y: number }>(FRONT_AT);
  // Its own scale once the User scales it; until then it starts as `startScale` says.
  const [own, setOwn] = useState<number | null>(null);
  const [lifted, setLifted] = useState(false);

  const base = frontWidth(canvas.w);
  const scale = own ?? startScale({ natural: measured.h, canvasHeight: canvas.h, kept: kept });
  const width = base * scale;
  const height = measured.h * scale;

  useLayoutEffect(() => onBox({ x: at.x, y: at.y, w: width, h: height }));

  const scaleTo = (next: number) => {
    const s = clamp(next, FRONT_SCALE.min, FRONT_SCALE.max);
    setOwn(s);
    onKeep(s);
  };

  const from = useRef({ at, scale, width, height });
  const begin = () => {
    from.current = { at, scale, width, height };
    setLifted(true);
  };
  const end = () => setLifted(false);

  // A drag's distance on screen, in Canvas units.
  const move = useDrag(
    nav,
    (dx, dy) => {
      const z = nav.zoom();
      setAt({ x: from.current.at.x + dx / z, y: from.current.at.y + dy / z });
    },
    begin,
    end,
  );
  const corner = useRef<Corner>("br");
  const cornerDrag = useDrag(
    nav,
    (dx, dy) => {
      const f = from.current;
      const z = nav.zoom();
      const to = scaleFromCorner({ ...f.at, ...f }, corner.current, dx / z, dy / z);
      setAt({ x: to.x, y: to.y });
      scaleTo(to.scale);
    },
    begin,
    end,
  );

  const onKey = (event: KeyboardEvent) => {
    // The browser's own: its zoom (Ctrl/⌘ with + − 0), Back and Forward (Alt with an arrow).
    if (event.ctrlKey || event.metaKey || event.altKey) return;
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
    if (d !== undefined) setAt({ x: at.x + d[0], y: at.y + d[1] });
    else if (scaled !== undefined) scaleTo(scaled);
    else return;
    event.preventDefault();
  };

  return (
    <section
      aria-label="Front"
      aria-roledescription="movable note"
      aria-describedby="front-moves"
      data-front
      // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- it moves and scales from the keyboard too
      tabIndex={0}
      style={{ left: at.x, top: at.y, width }}
      onFocus={() => onSelect(true)}
      onKeyDown={onKey}
      className={cn(
        "group/front absolute touch-none outline-none select-none",
        selected && (lifted ? "cursor-grabbing" : "cursor-grab"),
      )}
      {...move}
      onPointerDown={(event) => {
        // Unselected, a drag on it pans the Canvas and a tap selects it (the Canvas's own).
        if (selected) move.onPointerDown(event);
      }}
    >
      <span id="front-moves" className="sr-only">
        Tap it to select it, then drag it to move it, or a corner to scale it. Arrow keys move it;
        plus and minus scale it, and 0 sets it back to 100%.
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
        ref={setMeasureEl}
        data-front-measure
        aria-hidden
        style={{ width: base, zoom: measureZoom(drawnAt) }}
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
              zoom={nav.zoom()}
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

// Below 1024 px the left ones reach in, not out, with the dot still on the corner,
// so the canvas's edge doesn't clip them where the Front starts.
const CORNER_AT: Record<Corner, string> = {
  tl: "-top-[22px] -left-3 cursor-nwse-resize justify-start pl-[5px] lg:-top-3 lg:justify-center lg:pl-0",
  tr: "-top-[22px] -right-[22px] cursor-nesw-resize justify-center lg:-top-3 lg:-right-3",
  bl: "-bottom-[22px] -left-3 cursor-nesw-resize justify-start pl-[5px] lg:-bottom-3 lg:justify-center lg:pl-0",
  br: "-right-[22px] -bottom-[22px] cursor-nwse-resize justify-center lg:-right-3 lg:-bottom-3",
};

/**
 * A corner's handle: small to see, 44 px to touch below 1024 px, at every
 * zoom. The view keeps its scale up to date as it zooms.
 */
function Handle({ drag, className, zoom }: { drag: Drag; className: string; zoom: number }) {
  return (
    <span
      {...drag}
      aria-hidden
      data-corner
      title="Drag to scale"
      style={{ scale: String(1 / zoom) }}
      className={cn("absolute z-10 flex size-11 touch-none items-center lg:size-6", className)}
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

/** Pen (with its thickness), eraser, undo, redo and clear, in a column: disabled until BAN-47. */
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

/** − / the zoom (tap it for 100%) / + / Fit, at the bottom-left. It alone re-renders as the zoom changes. */
function ZoomControl({ nav, onFit }: { nav: Navigator; onFit: () => void }) {
  const zoom = useSyncExternalStore(nav.subscribe, nav.zoom, nav.zoom);
  const percent = Math.round(zoom * 100);
  return (
    <div
      role="group"
      aria-label="Zoom"
      data-chrome
      data-zoom
      className="absolute bottom-3 left-3 flex items-center gap-0.5 rounded-full border bg-background/95 p-1 shadow-sm backdrop-blur"
    >
      <button
        type="button"
        aria-label="Zoom out"
        disabled={zoom <= ZOOM.min}
        onClick={() => nav.step(-1)}
        className={ZOOM_BUTTON}
      >
        <Minus aria-hidden className="size-4" />
      </button>
      <button
        type="button"
        aria-label={`Zoom ${percent}%, back to 100%`}
        onClick={() => nav.zoomTo(1)}
        className={cn(ZOOM_BUTTON, "w-16 tabular-nums lg:w-14")}
      >
        {percent}%
      </button>
      <button
        type="button"
        aria-label="Zoom in"
        disabled={zoom >= ZOOM.max}
        onClick={() => nav.step(1)}
        className={ZOOM_BUTTON}
      >
        <Plus aria-hidden className="size-4" />
      </button>
      <span aria-hidden className="mx-0.5 h-6 w-px bg-border" />
      <button type="button" aria-label="Fit" onClick={onFit} className={ZOOM_BUTTON}>
        <ScanSearch aria-hidden className="size-4" />
        Fit
      </button>
    </div>
  );
}

/** The size of the element it's given, kept up to date. */
function useSize(el: HTMLElement | null) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    if (el === null) return () => {};
    const measure = () =>
      setSize((s) =>
        s.w === el.offsetWidth && s.h === el.offsetHeight
          ? s
          : { w: el.offsetWidth, h: el.offsetHeight },
      );
    measure();
    if (typeof ResizeObserver === "undefined") return () => {};
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [el]);
  return size;
}

/**
 * Pointer handlers for a drag by a finger or the mouse: `move` gets the
 * distance from where it started, on screen. It keeps the press to itself, so
 * the Canvas under it doesn't pan or take it as a tap, and it stops where
 * `nav` finds a palm: a touch that was down while the pen was.
 */
function useDrag(
  nav: Navigator,
  move: (dx: number, dy: number) => void,
  start: () => void,
  end: () => void,
) {
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
  useEffect(() => () => void (from.current = null), []);
  return {
    onPointerDown: (event: PointerEvent) => {
      if (event.pointerType === "pen" || nav.ignores(event.pointerId)) return;
      if (event.pointerType === "mouse" && event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      try {
        event.currentTarget.setPointerCapture?.(event.pointerId);
      } catch {
        // A pointer the browser no longer has.
      }
      from.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
      handlers.current.start();
    },
    onPointerMove: (event: PointerEvent) => {
      const f = from.current;
      if (f?.id !== event.pointerId) return;
      if (nav.ignores(event.pointerId)) {
        stop(event);
        return;
      }
      handlers.current.move(event.clientX - f.x, event.clientY - f.y);
    },
    onPointerUp: stop,
    onPointerCancel: stop,
  };
}
type Drag = ReturnType<typeof useDrag>;
