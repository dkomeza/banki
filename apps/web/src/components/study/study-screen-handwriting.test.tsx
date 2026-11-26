// @vitest-environment happy-dom
import type { SettingsResponse } from "@banki/shared";
import { EditorView } from "@codemirror/view";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  RouterContextProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Profiler } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Card } from "@/lib/cards";
import type { Deck } from "@/lib/decks";
import { settingsQueryOptions } from "@/lib/settings";
import { StudyScreen } from "./study-screen";

vi.mock("@/components/folders/drag", () => ({ useFinePointer: () => true }));

const DECK: Deck = {
  id: "d1",
  name: "Calculus 2",
  description: null,
  folderId: null,
  createdAt: "2026-05-01T09:00:00.000Z",
  cardCount: 2,
  desiredRetention: null,
  macros: [],
  answerMode: "write",
  plan: null,
  cardPrompt: { language: "", count: null, difficulty: "intermediate", instructions: "" },
};

const SETTINGS: SettingsResponse = {
  timezone: "Europe/Warsaw",
  dayStartHour: 4,
  model: "anthropic/claude-haiku-5.5",
  apiKey: { state: "unset" },
  autoClose: "brackets",
  desiredRetention: 90,
  newCardBatch: 20,
  learningLimit: 10,
  sessionTimeoutMinutes: 30,
  answerMode: "self-rate",
  macros: [],
};

const card = (id: string): Card => ({
  id,
  deckId: "d1",
  front: `${id} front`,
  back: `${id} back`,
  tags: [],
  gradingNotes: null,
  createdAt: "2026-05-01T09:00:00.000Z",
  updatedAt: "2026-05-01T09:00:00.000Z",
  studied: false,
});

const preview = { state: "learning", scheduledDays: 0, due: "2099-05-01T09:10:00.000Z" };
const schedule = {
  state: "new",
  due: null,
  stability: 0,
  difficulty: 0,
  reps: 0,
  lapses: 0,
  scheduledDays: 0,
  lastReview: null,
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

let queue: string[] = [];
let rated: { cardId: string; body: unknown }[] = [];
let graded: string[] = [];

beforeEach(() => {
  queue = ["c1", "c2"];
  rated = [];
  graded = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const path = new URL(request.url, "http://banki.test").pathname;
    if (path === "/api/decks/d1/study/next") {
      const id = queue.shift();
      return json({
        next:
          id === undefined
            ? null
            : {
                card: card(id),
                schedule,
                kind: "new",
                intervals: { again: preview, hard: preview, good: preview, easy: preview },
              },
        newHeld: 0,
      });
    }
    const review = path.match(/^\/api\/cards\/(\w+)\/reviews$/);
    if (review !== null) {
      const cardId = review[1] ?? "";
      rated.push({ cardId, body: await request.clone().json() });
      return json(
        {
          review: {
            id: `r-${cardId}`,
            cardId,
            deckId: "d1",
            reviewedAt: "2026-05-01T09:00:00.000Z",
            rating: "again",
            kind: "self-rated",
            suggestedRating: null,
            model: null,
            durationMs: 0,
          },
          schedule,
        },
        201,
      );
    }
    const grading = path.match(/^\/api\/cards\/(\w+)\/grade$/);
    if (grading !== null) {
      graded.push(grading[1] ?? "");
      return json({}, 500);
    }
    // Undo: the Rating taken back, the Card as it was.
    const undone = path.match(/^\/api\/reviews\/r-(\w+)$/);
    if (undone !== null) {
      return json({
        card: card(undone[1] ?? ""),
        schedule,
        intervals: { again: preview, hard: preview, good: preview, easy: preview },
      });
    }
    const reread = path.match(/^\/api\/cards\/(\w+)$/);
    if (reread !== null) return json({ ...card(reread[1] ?? ""), schedule });
    if (/^\/api\/cards\/\w+\/intervals$/.test(path)) {
      return json({ again: preview, hard: preview, good: preview, easy: preview });
    }
    if (path === "/api/decks/d1/cards") return json([card("c1"), card("c2")]);
    return json([]);
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

/** The study screen for `deck`, in the handwriting layout when `handwriting`. */
function renderScreen({ deck = DECK, handwriting = true } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(settingsQueryOptions().queryKey, { settings: SETTINGS, issuedAt: 0 });
  const router = createRouter({ routeTree: createRootRoute(), history: createMemoryHistory() });
  const ui = (hand: boolean) => (
    <QueryClientProvider client={queryClient}>
      <RouterContextProvider router={router}>
        <Profiler id="study" onRender={() => void (renders.count += 1)}>
          <StudyScreen deck={deck} handwriting={hand} />
        </Profiler>
      </RouterContextProvider>
    </QueryClientProvider>
  );
  const { rerender } = render(ui(handwriting));
  return {
    router,
    setHandwriting: (hand: boolean) => rerender(ui(hand)),
    rerenderScreen: () => rerender(ui(handwriting)),
  };
}

const tools = () => screen.queryByRole("toolbar", { name: "Handwriting tools" });
const check = () => screen.getByRole<HTMLButtonElement>("button", { name: /Check/ });
const dontKnow = () => screen.getByRole<HTMLButtonElement>("button", { name: "I don't know" });
/** How many times the study screen has rendered, for counting renders during a Stroke. */
const renders = { count: 0 };

const viewport = () => document.querySelector<HTMLElement>("[data-handwriting]")!;
/** The grid paper, where a pointer lands on the Canvas off the Front. */
const paper = () => screen.getByRole("img", { name: "Handwritten answer" });
/** The layer that holds the Front and the Ink, under the view's transform. */
const layer = () => document.querySelector<HTMLElement>("[data-canvas-layer]")!;
const ink = () => document.querySelector<SVGSVGElement>("svg[data-ink]")!;
/** Inside the layer: laid out at the zoom the view last rested at. */
const drawn = () => document.querySelector<HTMLElement>("[data-canvas-zoom]")!;
/** The Front's unseen copy at 100%, which measures it. */
const measure = () => document.querySelector<HTMLElement>("[data-front-measure]")!;
/** The canvas the paper's grid is drawn on. */
const grid = () => document.querySelector<HTMLCanvasElement>("canvas[data-grid]")!;
const strokes = () => Array.from(ink().querySelectorAll("path"));
const selected = () => front().querySelectorAll("[data-corner]").length === 4;
const zoomIn = () => screen.getByRole<HTMLButtonElement>("button", { name: "Zoom in" });
const zoomOut = () => screen.getByRole<HTMLButtonElement>("button", { name: "Zoom out" });
const zoomReadout = () => screen.getByRole<HTMLButtonElement>("button", { name: /back to 100%/ });

/** Lets the view rest, past the moment the layer is drawn afresh. */
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 250)));

/** A layer's transform, read back. */
function parse(transform: string): { x: number; y: number; zoom: number } {
  const m = /translate\((-?[\d.e-]+)px, (-?[\d.e-]+)px\) scale\(([\d.e-]+)\)/.exec(transform);
  if (m === null) throw new Error(`Not a view: ${transform}`);
  return { x: Number(m[1]), y: Number(m[2]), zoom: Number(m[3]) };
}

/** The x of each point in SVG path data. */
const xs = (d: string) =>
  (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number).filter((_, i) => i % 2 === 0);

const DEFAULT_ID: Record<string, number> = { pen: 9, touch: 1, mouse: 2 };

/** A synthetic pointer event of `pointerType` at a point on screen. */
function pointer(
  type: "pointerDown" | "pointerMove" | "pointerUp",
  el: Element,
  pointerType: "pen" | "touch" | "mouse",
  clientX: number,
  clientY: number,
  init: Record<string, unknown> = {},
) {
  fireEvent[type](el, {
    pointerType,
    pointerId: DEFAULT_ID[pointerType],
    clientX,
    clientY,
    button: type === "pointerMove" ? -1 : 0,
    buttons: type === "pointerUp" ? 0 : 1,
    pressure: pointerType === "pen" ? 0.5 : 0,
    ...init,
  });
}

function tap(el: Element, type: "touch" | "mouse") {
  pointer("pointerDown", el, type, 10, 10);
  pointer("pointerUp", el, type, 10, 10);
}

/** A finger or mouse drag from one point to another, by way of halfway. */
function drag(
  el: Element,
  type: "touch" | "mouse",
  [x0, y0]: [number, number],
  [x1, y1]: [number, number],
) {
  pointer("pointerDown", el, type, x0, y0);
  pointer("pointerMove", el, type, (x0 + x1) / 2, (y0 + y1) / 2);
  pointer("pointerMove", el, type, x1, y1);
  pointer("pointerUp", el, type, x1, y1);
}

/** A pen Stroke through `points` (x, y and pressure, on screen), from its tip unless `buttons` say otherwise. */
function write(
  el: Element,
  points: [number, number, number][],
  { button = 0, buttons = 1 }: { button?: number; buttons?: number } = {},
) {
  const [first, ...rest] = points;
  if (first === undefined) return;
  pointer("pointerDown", el, "pen", first[0], first[1], { pressure: first[2], button, buttons });
  for (const [x, y, pressure] of rest) {
    pointer("pointerMove", el, "pen", x, y, { pressure, buttons });
  }
  const last = points.at(-1) ?? first;
  pointer("pointerUp", el, "pen", last[0], last[1], { pressure: 0, button });
}

/** A wheel event on the Canvas; false when it was stopped. */
function wheel(init: {
  deltaX?: number;
  deltaY?: number;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  clientX?: number;
  clientY?: number;
}): boolean {
  const event = new WheelEvent("wheel", { bubbles: true, cancelable: true });
  // happy-dom drops most of a WheelEvent's init.
  for (const [key, value] of Object.entries({ deltaX: 0, deltaY: 0, deltaMode: 0, ...init })) {
    Object.defineProperty(event, key, { value });
  }
  let result = true;
  act(() => {
    result = viewport().dispatchEvent(event);
  });
  return result;
}

/** Waits a frame. */
const frame = () =>
  act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));

/** A pen sample at `x`, as getCoalescedEvents gives them. */
const sample = (x: number) => ({ clientX: x, clientY: 300, pressure: 0.5 });

/**
 * A stand-in for the canvases' contexts, which happy-dom has none of,
 * recording what the live canvas draws and the grid's lines.
 */
function liveContext() {
  const live = {
    options: undefined as unknown,
    fills: [] as string[],
    cleared: 0,
    grid: [] as [number, number, number, number][],
  };
  class FakePath {
    constructor(readonly d: string) {}
  }
  vi.stubGlobal("Path2D", FakePath);
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- getContext's overloads, stood in for by one
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (
    this: HTMLCanvasElement,
    _type: string,
    options: unknown,
  ) {
    if (this.hasAttribute("data-grid")) {
      return {
        fillStyle: "",
        globalAlpha: 1,
        setTransform: () => {},
        clearRect: () => void (live.grid = []),
        fillRect: (...rect: [number, number, number, number]) => void live.grid.push(rect),
      };
    }
    live.options = options;
    return {
      fillStyle: "",
      setTransform: () => {},
      clearRect: () => void (live.cleared += 1),
      fill: (path: FakePath) => void live.fills.push(path.d),
    };
  } as never);
  return live;
}

/** Waits for the Front in the handwriting layout. */
const shown = () => screen.findByRole("region", { name: "Front" });
const front = () => screen.getByRole("region", { name: "Front" });
/** The scale the Front is drawn at. */
const frontScale = () =>
  Number(front().querySelector("[data-front-scale]")?.getAttribute("data-front-scale"));

async function answerEditor(): Promise<EditorView> {
  const editor = await waitFor(() => {
    const found = document.querySelector("[data-answer-editor] .cm-editor");
    if (!(found instanceof HTMLElement)) throw new Error("No answer editor yet");
    return found;
  });
  const view = EditorView.findFromDOM(editor);
  if (view === null) throw new Error("No view");
  return view;
}

/** Everything in localStorage, by key. */
const stored = () =>
  Object.fromEntries(
    Array.from({ length: localStorage.length }, (_, i) => {
      const key = localStorage.key(i) ?? "";
      return [key, localStorage.getItem(key)];
    }),
  );

/** Sizes the canvas and the Front's unseen copy at 100%, which happy-dom doesn't lay out. */
function layOut({ canvas, natural }: { canvas: { w: number; h: number }; natural: number }) {
  const size = (el: HTMLElement, side: "w" | "h") =>
    el.hasAttribute("data-handwriting")
      ? canvas[side]
      : el.hasAttribute("data-front-measure")
        ? side === "w"
          ? 416
          : natural
        : 0;
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return size(this, "w");
  });
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return size(this, "h");
  });
}

describe("the handwriting layout", () => {
  test("?handwriting=1 shows the Front on a canvas, the tool bar and the dock, and no answer editor", async () => {
    renderScreen();
    await shown();

    expect(front().textContent).toContain("c1 front");
    expect(screen.getByRole("img", { name: "Handwritten answer" })).toBeTruthy();
    expect(tools()).not.toBeNull();
    expect(document.querySelector("[data-answer-editor]")).toBeNull();
    expect(screen.queryByText("Your answer")).toBeNull();
    // The top bar is as it is.
    expect(screen.getByLabelText("Back to deck")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Write and grade" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Edit card" }).disabled).toBe(
      false,
    );
  });

  test("the tool bar's controls are named and disabled, with Pen pressed; the zoom control works", async () => {
    renderScreen();
    await shown();

    for (const name of ["Pen", "Eraser", "Undo stroke", "Redo stroke", "Clear"]) {
      expect(screen.getByRole<HTMLButtonElement>("button", { name }).disabled).toBe(true);
    }
    const thickness = screen.getByRole("radiogroup", { name: "Pen thickness" });
    for (const name of ["Fine", "Medium", "Bold"]) {
      const radio = screen.getByRole<HTMLButtonElement>("radio", { name });
      expect(thickness.contains(radio)).toBe(true);
      expect(radio.disabled).toBe(true);
    }
    expect(screen.getByRole("button", { name: "Pen" }).getAttribute("aria-pressed")).toBe("true");
    for (const name of ["Zoom out", "Zoom in", "Fit"]) {
      expect(screen.getByRole<HTMLButtonElement>("button", { name }).disabled).toBe(false);
    }
    expect(zoomReadout().textContent).toBe("100%");
  });

  test("Check is disabled and I don't know enabled; Ctrl+Enter, Space and Enter do nothing", async () => {
    renderScreen();
    await shown();

    expect(check().disabled).toBe(true);
    expect(dontKnow().disabled).toBe(false);

    fireEvent.keyDown(document.body, { key: "Enter", ctrlKey: true });
    fireEvent.keyDown(document.body, { key: "Enter", metaKey: true });
    fireEvent.keyDown(document.body, { key: " " });
    fireEvent.keyDown(document.body, { key: "Enter" });
    await act(async () => {});

    expect(graded).toEqual([]);
    expect(screen.queryByText("c1 back")).toBeNull();
    expect(tools()).not.toBeNull();
  });

  test("with a typed draft standing, Check stays disabled and Ctrl+Enter checks nothing", async () => {
    const { setHandwriting } = renderScreen({ handwriting: false });
    const view = await answerEditor();
    act(() => view.dispatch({ changes: { from: 0, insert: "half" } }));
    await waitFor(() => expect(check().disabled).toBe(false));

    setHandwriting(true);
    await shown();
    expect(check().disabled).toBe(true);
    fireEvent.keyDown(document.body, { key: "Enter", ctrlKey: true });
    fireEvent.keyDown(front(), { key: "Enter", ctrlKey: true });
    fireEvent.keyDown(document.body, { key: "Enter", metaKey: true });
    await act(async () => {});

    expect(graded).toEqual([]);
    expect(tools()).not.toBeNull();
  });

  test("without the param the screen is as it is: the answer editor, and no tool bar", async () => {
    renderScreen({ handwriting: false });
    await answerEditor();

    expect(tools()).toBeNull();
    expect(screen.queryByRole("region", { name: "Front" })).toBeNull();
    expect(screen.getByText("Your answer")).toBeTruthy();
  });

  test("the param is ignored in self-rate", async () => {
    renderScreen({ deck: { ...DECK, answerMode: "self-rate" } });
    await screen.findByText("c1 front");

    expect(tools()).toBeNull();
    expect(screen.getByRole("button", { name: /Show answer/ })).toBeTruthy();
  });

  test("I don't know rates Again and reveals as it does today, and the revealed Card ignores the param", async () => {
    renderScreen();
    await shown();

    fireEvent.click(dontKnow());
    await screen.findByText("c1 back");
    await waitFor(() => expect(rated).toHaveLength(1));
    expect(rated[0]?.cardId).toBe("c1");
    expect(rated[0]?.body).toMatchObject({ rating: "again" });

    expect(tools()).toBeNull();
    expect(screen.queryByRole("region", { name: "Front" })).toBeNull();
    expect(screen.getByText("c1 front")).toBeTruthy();
  });

  test("the next Card shows in the handwriting layout too, and Undo brings the last one back revealed, as today", async () => {
    renderScreen();
    await shown();

    fireEvent.click(dontKnow());
    const next = await screen.findByRole<HTMLButtonElement>("button", { name: /Next/ });
    await waitFor(() => expect(next.disabled).toBe(false));
    fireEvent.click(next);

    await waitFor(() => expect(front().textContent).toContain("c2 front"));
    expect(tools()).not.toBeNull();
    expect(check().disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await screen.findByText("c1 back");
    expect(tools()).toBeNull();
  });

  test("Esc leaves, as it does today", async () => {
    const { router } = renderScreen();
    await shown();

    act(() => front().focus());
    fireEvent.keyDown(front(), { key: "Escape" });

    await waitFor(() => expect(router.history.location.pathname).toBe("/decks/d1"));
  });

  test("a typed draft is kept, untouched, through a visit to the handwriting layout", async () => {
    const { setHandwriting } = renderScreen({ handwriting: false });
    const view = await answerEditor();
    act(() => view.dispatch({ changes: { from: 0, insert: "half" } }));
    await waitFor(() => expect(localStorage.length).toBeGreaterThan(0));
    const saved = stored();

    setHandwriting(true);
    await waitFor(() => expect(tools()).not.toBeNull());
    expect(document.querySelector("[data-answer-editor]")).toBeNull();
    // The layout adds nothing to the Session's saved state.
    expect(stored()).toEqual(saved);

    setHandwriting(false);
    const back = await answerEditor();
    expect(back.state.doc.toString()).toBe("half");
  });
});

describe("the Front in the handwriting layout", () => {
  test("a Front that fits shows at 100%", async () => {
    layOut({ canvas: { w: 1440, h: 750 }, natural: 120 });
    renderScreen();
    await shown();

    expect(frontScale()).toBe(1);
  });

  test("a long Front starts scaled down to fit, and its corners scale it", async () => {
    layOut({ canvas: { w: 1440, h: 750 }, natural: 1000 });
    renderScreen();
    await shown();

    // 60% of the canvas's 750 px, of the Front's 1000.
    expect(frontScale()).toBeCloseTo(0.45);

    // Tapped, it's selected: a handle at each corner, and no label.
    tap(front(), "touch");
    const corners = front().querySelectorAll("[data-corner]");
    expect(corners).toHaveLength(4);

    // The bottom-right corner, dragged out by its width (187 px at 45%): twice the size.
    const br = corners[3]!;
    fireEvent.pointerDown(br, { pointerId: 2, button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(br, { pointerId: 2, clientX: 416 * 0.45, clientY: 0 });
    fireEvent.pointerUp(br, { pointerId: 2 });
    expect(frontScale()).toBeCloseTo(0.9);

    // Tapping the paper lets go of it.
    tap(paper(), "touch");
    expect(front().querySelectorAll("[data-corner]")).toHaveLength(0);
  });

  test("the next Card's Front starts at the scale the User chose", async () => {
    layOut({ canvas: { w: 1440, h: 750 }, natural: 120 });
    renderScreen();
    await shown();

    act(() => front().focus());
    fireEvent.keyDown(front(), { key: "+" });
    expect(frontScale()).toBeCloseTo(1.1);

    fireEvent.click(dontKnow());
    const next = await screen.findByRole<HTMLButtonElement>("button", { name: /Next/ });
    await waitFor(() => expect(next.disabled).toBe(false));
    fireEvent.click(next);
    await waitFor(() => expect(front().textContent).toContain("c2 front"));

    expect(frontScale()).toBeCloseTo(1.1);
  });

  test("leaves the browser its own keys: Ctrl/⌘ with + − 0, and Alt with an arrow", async () => {
    layOut({ canvas: { w: 800, h: 600 }, natural: 120 });
    renderScreen();
    await shown();
    act(() => front().focus());

    for (const init of [
      { key: "+", ctrlKey: true },
      { key: "-", metaKey: true },
      { key: "0", ctrlKey: true },
      { key: "ArrowLeft", altKey: true },
    ]) {
      expect(fireEvent.keyDown(front(), init)).toBe(true);
    }
    expect(frontScale()).toBe(1);
    expect(front().style.left).toBe("12px");
  });

  test("drags and arrow keys move it once it is selected, as far as the User likes", async () => {
    layOut({ canvas: { w: 800, h: 600 }, natural: 120 });
    renderScreen();
    await shown();
    expect(front().style.left).toBe("12px");
    expect(front().style.top).toBe("28px");

    tap(front(), "touch");
    expect(selected()).toBe(true);

    drag(front(), "touch", [100, 100], [150, 120]);
    expect(front().style.left).toBe("62px");
    expect(front().style.top).toBe("48px");

    act(() => front().focus());
    fireEvent.keyDown(front(), { key: "ArrowLeft" });
    fireEvent.keyDown(front(), { key: "ArrowUp", shiftKey: true });
    expect(front().style.left).toBe("54px");
    expect(front().style.top).toBe("8px");

    // No edges: the 48 px rule is gone.
    drag(front(), "mouse", [0, 0], [5000, -5000]);
    expect(front().style.left).toBe("5054px");
    expect(front().style.top).toBe("-4992px");
    // The Canvas didn't pan under it.
    expect(layer().style.transform).toBe("translate(0px, 0px) scale(1)");
  });

  test("unselected, a drag on it pans the Canvas, so a resting palm never moves it", async () => {
    layOut({ canvas: { w: 800, h: 600 }, natural: 120 });
    renderScreen();
    await shown();

    drag(front(), "touch", [100, 100], [160, 140]);
    expect(front().style.left).toBe("12px");
    expect(selected()).toBe(false);
    expect(layer().style.transform).toBe("translate(60px, 40px) scale(1)");

    drag(front(), "mouse", [100, 100], [90, 100]);
    expect(layer().style.transform).toBe("translate(50px, 40px) scale(1)");
    expect(selected()).toBe(false);

    // A tap on the paper, and on the Front, by mouse.
    tap(paper(), "mouse");
    expect(selected()).toBe(false);
    tap(front(), "mouse");
    expect(selected()).toBe(true);
  });

  test("moves by the distance on screen in Canvas units when zoomed", async () => {
    layOut({ canvas: { w: 800, h: 600 }, natural: 120 });
    renderScreen();
    await shown();

    fireEvent.click(zoomIn());
    tap(front(), "touch");
    drag(front(), "touch", [100, 100], [225, 100]);
    // 125 px on screen at 125% is 100 on the Canvas.
    expect(front().style.left).toBe("112px");
  });
});

describe("Ink", () => {
  test("the pen writes a Stroke, which becomes a path in the theme's foreground over the Front's layer", async () => {
    layOut({ canvas: { w: 800, h: 600 }, natural: 120 });
    renderScreen();
    await shown();

    write(paper(), [
      [100, 300, 0.3],
      [140, 320, 0.6],
      [180, 310, 0.8],
    ]);

    expect(strokes()).toHaveLength(1);
    const svg = ink();
    expect(svg.getAttribute("class")).toContain("text-foreground");
    expect(strokes()[0]?.getAttribute("fill")).toBe("currentColor");
    expect(strokes()[0]?.getAttribute("d")).toMatch(/^M.+Z$/);
    // In the layer that holds the Front, after it, so the Ink is drawn over it.
    expect(svg.closest("[data-canvas-layer]")).toBe(layer());
    expect(svg.parentElement?.lastElementChild).toBe(svg);
    expect(svg.compareDocumentPosition(front()) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  });

  test("a finger and the mouse never draw, nor do the pen's eraser end and barrel button", async () => {
    layOut({ canvas: { w: 800, h: 600 }, natural: 120 });
    renderScreen();
    await shown();

    drag(paper(), "touch", [100, 300], [200, 400]);
    drag(paper(), "mouse", [100, 300], [200, 400]);
    // The eraser end, and the tip with the barrel button held.
    write(
      paper(),
      [
        [100, 300, 0.5],
        [150, 300, 0.5],
      ],
      { button: 5, buttons: 32 },
    );
    write(
      paper(),
      [
        [100, 300, 0.5],
        [150, 300, 0.5],
      ],
      { button: 0, buttons: 3 },
    );
    write(
      paper(),
      [
        [100, 300, 0.5],
        [150, 300, 0.5],
      ],
      { button: 2, buttons: 2 },
    );

    expect(strokes()).toHaveLength(0);
  });

  test("the pen writes over the Front, and never selects, moves or scales it", async () => {
    layOut({ canvas: { w: 800, h: 600 }, natural: 120 });
    renderScreen();
    await shown();

    write(front(), [[50, 60, 0.5]]);
    write(front(), [
      [50, 60, 0.5],
      [300, 90, 0.5],
    ]);
    expect(strokes()).toHaveLength(2);
    expect(selected()).toBe(false);
    expect(front().style.left).toBe("12px");

    // Selected, too: the pen still only writes, on it and on a corner.
    tap(front(), "touch");
    write(front(), [
      [50, 60, 0.5],
      [300, 90, 0.5],
    ]);
    write(front().querySelectorAll("[data-corner]")[3]!, [
      [0, 0, 0.5],
      [400, 400, 0.5],
    ]);
    expect(strokes()).toHaveLength(4);
    expect(front().style.left).toBe("12px");
    expect(frontScale()).toBe(1);
    expect(layer().style.transform).toBe("translate(0px, 0px) scale(1)");
  });

  test("no React render runs for each pen sample, and one does when the pen lifts", async () => {
    layOut({ canvas: { w: 800, h: 600 }, natural: 120 });
    renderScreen();
    await shown();
    await act(async () => {});

    renders.count = 0;
    pointer("pointerDown", paper(), "pen", 100, 300, { pressure: 0.5 });
    for (let i = 1; i <= 30; i++)
      pointer("pointerMove", paper(), "pen", 100 + i * 4, 300, { pressure: 0.5 });
    await frame();
    expect(renders.count).toBe(0);

    pointer("pointerUp", paper(), "pen", 220, 300, { pressure: 0 });
    expect(renders.count).toBeGreaterThan(0);
    expect(strokes()).toHaveLength(1);
  });

  test("the Stroke being written is drawn on its own viewport-sized canvas in the next frame, from coalesced and predicted samples", async () => {
    layOut({ canvas: { w: 800, h: 600 }, natural: 120 });
    const live = liveContext();
    renderScreen();
    await shown();
    const canvas = document.querySelector<HTMLCanvasElement>("canvas[data-live-ink]")!;
    expect(canvas.width).toBe(800);
    expect(canvas.height).toBe(600);
    expect(live.options).toEqual({ desynchronized: true });

    pointer("pointerDown", paper(), "pen", 100, 300, { pressure: 0.5 });
    const move = new PointerEvent("pointermove", {
      bubbles: true,
      pointerType: "pen",
      pointerId: 9,
      clientX: 160,
      clientY: 300,
      pressure: 0.5,
      buttons: 1,
    });
    Object.defineProperty(move, "getCoalescedEvents", {
      value: () => [sample(120), sample(140), sample(160)],
    });
    Object.defineProperty(move, "getPredictedEvents", { value: () => [sample(400)] });
    act(() => void paper().dispatchEvent(move));
    expect(live.fills).toHaveLength(0);

    await frame();
    // Drawn once in the frame, reaching on towards the predicted sample.
    expect(live.fills).toHaveLength(1);
    const reach = Math.max(...xs(live.fills[0]!));
    expect(reach).toBeGreaterThan(200);

    const cleared = live.cleared;
    pointer("pointerUp", paper(), "pen", 160, 300, { pressure: 0.5 });
    // The predicted sample is never kept: the path stops where the pen did,
    // and the live canvas is cleared as it shows.
    expect(Math.max(...xs(strokes()[0]!.getAttribute("d")!))).toBeLessThan(170);
    expect(live.cleared).toBeGreaterThan(cleared);
    expect(live.fills).toHaveLength(1);
  });

  test("Ink is kept through re-renders and resizing, and gone on the next Card, which starts afresh", async () => {
    layOut({ canvas: { w: 800, h: 600 }, natural: 120 });
    const { rerenderScreen } = renderScreen();
    await shown();

    write(paper(), [
      [100, 300, 0.5],
      [150, 300, 0.5],
    ]);
    fireEvent.click(zoomIn());
    rerenderScreen();
    act(() => void window.dispatchEvent(new Event("resize")));
    expect(strokes()).toHaveLength(1);

    fireEvent.click(dontKnow());
    const next = await screen.findByRole<HTMLButtonElement>("button", { name: /Next/ });
    await waitFor(() => expect(next.disabled).toBe(false));
    fireEvent.click(next);
    await waitFor(() => expect(front().textContent).toContain("c2 front"));

    expect(strokes()).toHaveLength(0);
    expect(layer().style.transform).toBe("translate(0px, 0px) scale(1)");
    expect(zoomReadout().textContent).toBe("100%");
    expect(front().style.left).toBe("12px");
    expect(front().style.top).toBe("28px");
  });

  test("Ink is gone on Undo, and when the same Card comes back", async () => {
    layOut({ canvas: { w: 800, h: 600 }, natural: 120 });
    queue = ["c1", "c1", "c2"];
    renderScreen();
    await shown();

    write(paper(), [[100, 300, 0.5]]);
    expect(strokes()).toHaveLength(1);
    fireEvent.click(dontKnow());
    const next = await screen.findByRole<HTMLButtonElement>("button", { name: /Next/ });
    await waitFor(() => expect(next.disabled).toBe(false));
    fireEvent.click(next);
    await waitFor(() => expect(tools()).not.toBeNull());
    expect(front().textContent).toContain("c1 front");
    expect(strokes()).toHaveLength(0);

    write(paper(), [[100, 300, 0.5]]);
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await screen.findByText("c1 back");
    expect(document.querySelector("svg[data-ink]")).toBeNull();
  });
});

describe("navigating the Canvas", () => {
  test("one finger or a mouse drag on the paper pans, freely, with no Stroke drawn again", async () => {
    layOut({ canvas: { w: 800, h: 600 }, natural: 120 });
    renderScreen();
    await shown();
    write(paper(), [
      [100, 300, 0.5],
      [150, 300, 0.5],
    ]);
    const path = strokes()[0]!;
    const d = path.getAttribute("d");
    await act(async () => {});

    renders.count = 0;
    drag(paper(), "touch", [400, 300], [100, -200]);
    expect(layer().style.transform).toBe("translate(-300px, -500px) scale(1)");
    drag(paper(), "mouse", [100, 100], [900, 1300]);
    expect(layer().style.transform).toBe("translate(500px, 700px) scale(1)");
    // Only the layer's transform changed: no render, and the same path.
    expect(renders.count).toBe(0);
    expect(strokes()[0]).toBe(path);
    expect(path.getAttribute("d")).toBe(d);
  });

  test("two fingers pinch to zoom and pan together, within 25% to 400%", async () => {
    layOut({ canvas: { w: 800, h: 600 }, natural: 120 });
    renderScreen();
    await shown();

    pointer("pointerDown", paper(), "touch", 100, 100, { pointerId: 1 });
    pointer("pointerDown", paper(), "touch", 200, 100, { pointerId: 2 });
    pointer("pointerMove", paper(), "touch", 50, 150, { pointerId: 1 });
    pointer("pointerMove", paper(), "touch", 250, 150, { pointerId: 2 });
    expect(layer().style.transform).toBe("translate(-150px, -50px) scale(2)");
    expect(zoomReadout().textContent).toBe("200%");

    pointer("pointerMove", paper(), "touch", 2000, 150, { pointerId: 2 });
    expect(zoomReadout().textContent).toBe("400%");
    pointer("pointerMove", paper(), "touch", 51, 150, { pointerId: 2 });
    expect(zoomReadout().textContent).toBe("25%");
    pointer("pointerUp", paper(), "touch", 51, 150, { pointerId: 2 });
    pointer("pointerUp", paper(), "touch", 50, 150, { pointerId: 1 });
  });

  test("the wheel and a trackpad pan, Shift across; Ctrl/⌘ with the wheel zooms about the pointer", async () => {
    layOut({ canvas: { w: 800, h: 600 }, natural: 120 });
    renderScreen();
    await shown();

    // Stopped, so the page neither scrolls nor zooms.
    expect(wheel({ deltaY: 100 })).toBe(false);
    expect(layer().style.transform).toBe("translate(0px, -100px) scale(1)");
    wheel({ deltaX: 30, deltaY: -20 });
    expect(layer().style.transform).toBe("translate(-30px, -80px) scale(1)");
    wheel({ deltaY: 50, shiftKey: true });
    expect(layer().style.transform).toBe("translate(-80px, -80px) scale(1)");

    // A trackpad's pinch, in small steps, follows the fingers: 100 px of delta in all is e×.
    for (let i = 0; i < 10; i++) {
      wheel({ deltaY: (-100 * Math.LN2) / 10, ctrlKey: true, clientX: 200, clientY: 100 });
    }
    expect(zoomReadout().textContent).toBe("200%");
    // The paper under the pointer stayed there: (280, 180) on the Canvas.
    const v = parse(layer().style.transform);
    expect(v.zoom).toBeCloseTo(2);
    expect(v.x).toBeCloseTo(-360);
    expect(v.y).toBeCloseTo(-260);
    // A mouse wheel's notch steps by 1.25×.
    wheel({ deltaY: 100, ctrlKey: true, clientX: 200, clientY: 100 });
    expect(zoomReadout().textContent).toBe("160%");
    for (let i = 0; i < 10; i++) wheel({ deltaY: 100, metaKey: true, clientX: 200, clientY: 100 });
    expect(zoomReadout().textContent).toBe("25%");
  });

  test("the zoom control steps by 1.25×, goes back to 100% from its readout, and Fit frames the Front and the Ink", async () => {
    layOut({ canvas: { w: 800, h: 600 }, natural: 120 });
    renderScreen();
    await shown();

    fireEvent.click(zoomIn());
    expect(zoomReadout().textContent).toBe("125%");
    // About the centre: (400, 300) stays where it is.
    expect(layer().style.transform).toBe("translate(-100px, -75px) scale(1.25)");
    fireEvent.click(zoomOut());
    fireEvent.click(zoomOut());
    expect(zoomReadout().textContent).toBe("80%");
    fireEvent.click(zoomReadout());
    expect(zoomReadout().textContent).toBe("100%");
    expect(layer().style.transform).toBe("translate(0px, 0px) scale(1)");

    // A dot far down and right: Fit shows it and the Front (at 12, 28, 720 by
    // 120), with 24 px around them where they fill the view, centred the other way.
    write(paper(), [[790, 590, 0.5]]);
    fireEvent.click(screen.getByRole("button", { name: "Fit" }));
    const v = parse(layer().style.transform);
    expect(12 * v.zoom + v.x).toBeCloseTo(24);
    // The dot reaches 3.1 past its centre, its widest at full pressure.
    expect(793.1 * v.zoom + v.x).toBeCloseTo(776);
    expect((28 * v.zoom + v.y + 593.1 * v.zoom + v.y) / 2).toBeCloseTo(300);

    for (let i = 0; i < 10; i++) fireEvent.click(zoomIn());
    expect(zoomReadout().textContent).toBe("400%");
    expect(zoomIn().disabled).toBe(true);
  });

  test("the grid pans and scales with the Canvas, and fades below 50%", async () => {
    const live = liveContext();
    layOut({ canvas: { w: 800, h: 600 }, natural: 120 });
    renderScreen();
    await shown();
    /** Where the grid's upright lines were drawn, in device px (1 px to 1 here). */
    const uprights = () => live.grid.filter(([, , w, h]) => h > w).map(([x]) => x);
    expect(grid().dataset.cell).toBe("24");
    expect(grid().style.opacity).toBe("1");
    expect(uprights().slice(0, 3)).toEqual([0, 24, 48]);

    // Panned by 30 px, the lines are drawn again 30 px on, in the same move as the layer.
    drag(paper(), "touch", [100, 100], [130, 110]);
    expect(layer().style.transform).toBe("translate(30px, 10px) scale(1)");
    expect(uprights().slice(0, 3)).toEqual([6, 30, 54]);
    fireEvent.click(zoomOut());
    fireEvent.click(zoomOut());
    expect(Number(grid().style.opacity)).toBe(1);
    fireEvent.click(zoomOut());
    fireEvent.click(zoomOut());
    expect(zoomReadout().textContent).toBe("41%");
    expect(Number(grid().style.opacity)).toBeLessThan(1);
    expect(grid().dataset.cell).toMatch(/^9\.8\d*/);
    // On whole device pixels, so no line shimmers between two.
    expect(live.grid.every(([x, y]) => Number.isInteger(x) && Number.isInteger(y))).toBe(true);
  });

  test("while the view moves the compositor moves the layer, which is drawn afresh once it rests", async () => {
    layOut({ canvas: { w: 800, h: 600 }, natural: 120 });
    renderScreen();
    await shown();
    expect(layer().style.willChange).toBe("");
    drag(paper(), "touch", [100, 100], [160, 100]);
    expect(layer().style.willChange).toBe("transform");
    await act(() => new Promise((resolve) => setTimeout(resolve, 250)));
    expect(layer().style.willChange).toBe("");
  });

  test("zoomed in, the resting layer is laid out at its zoom, so the Ink is drawn crisp, not enlarged", async () => {
    vi.stubGlobal("CSS", { supports: (property: string) => property === "zoom" });
    layOut({ canvas: { w: 800, h: 600 }, natural: 120 });
    renderScreen();
    await shown();
    fireEvent.click(zoomIn());
    fireEvent.click(zoomIn());
    // While it moves, the transform scales the layer as it was drawn.
    expect(drawn().style.zoom).toBe("");
    expect(layer().style.transform).toBe("translate(-225px, -168.75px) scale(1.5625)");
    await settle();
    expect(drawn().style.zoom).toBe("1.5625");
    expect(layer().style.transform).toBe("translate(-225px, -168.75px) scale(1)");
    expect(layer().style.willChange).toBe("");
    // The Front's measure stays at 100%.
    expect(measure().style.zoom).toBe("0.64");
    // Moving on, the transform scales from where it was laid out.
    fireEvent.click(zoomIn());
    expect(parse(layer().style.transform).zoom).toBeCloseTo(1.25);
    expect(drawn().style.zoom).toBe("1.5625");
    // At 100% and below, the transform alone scales it again.
    fireEvent.click(zoomReadout());
    fireEvent.click(zoomOut());
    await settle();
    expect(drawn().style.zoom).toBe("");
    expect(measure().style.zoom).toBe("");
    expect(layer().style.transform).toBe("translate(80px, 60px) scale(0.8)");
    vi.unstubAllGlobals();
  });

  test("the corners stay the same size on screen as the view zooms, with no style worked out again below the layer", async () => {
    layOut({ canvas: { w: 800, h: 600 }, natural: 120 });
    renderScreen();
    await shown();
    tap(front(), "touch");
    const corners = () => Array.from(front().querySelectorAll<HTMLElement>("[data-corner]"));
    expect(corners().map((c) => c.style.scale)).toEqual(["1", "1", "1", "1"]);
    fireEvent.click(zoomIn());
    expect(corners().map((c) => c.style.scale)).toEqual(["0.8", "0.8", "0.8", "0.8"]);
    expect(layer().style.getPropertyValue("--zoom")).toBe("");
  });

  test("the Ink's SVG is as large as the Ink, so no browser clips what it draws", async () => {
    layOut({ canvas: { w: 800, h: 600 }, natural: 120 });
    renderScreen();
    await shown();
    write(paper(), [
      [300, 400, 0.5],
      [500, 450, 0.5],
    ]);
    const [x, y, w, h] = (ink().getAttribute("viewBox") ?? "").split(" ").map(Number);
    expect(x).toBeLessThanOrEqual(300);
    expect(y).toBeLessThanOrEqual(400);
    expect((x ?? 0) + (w ?? 0)).toBeGreaterThanOrEqual(500);
    expect((y ?? 0) + (h ?? 0)).toBeGreaterThanOrEqual(450);
    expect(ink().getAttribute("width")).toBe(String(w));
    expect(ink().style.left).toBe(`${x}px`);
  });

  test("a long press shows no callout: the context menu is stopped", async () => {
    layOut({ canvas: { w: 800, h: 600 }, natural: 120 });
    renderScreen();
    await shown();
    expect(fireEvent.contextMenu(paper())).toBe(false);
    expect(fireEvent.contextMenu(front())).toBe(false);
    expect(viewport().className).toMatch(/touch-none/);
    expect(viewport().className).toMatch(/select-none/);
    expect(viewport().className).toMatch(/touch-callout:none/);
  });
});

describe("palm rejection", () => {
  test("touches are ignored while the pen is down, and one down with it stays ignored until it lifts", async () => {
    layOut({ canvas: { w: 800, h: 600 }, natural: 120 });
    renderScreen();
    await shown();

    // A palm resting before the pen lands, and one landing while it writes.
    pointer("pointerDown", paper(), "touch", 500, 500, { pointerId: 1 });
    pointer("pointerDown", paper(), "pen", 100, 300, { pointerId: 9, pressure: 0.5 });
    pointer("pointerDown", paper(), "touch", 600, 500, { pointerId: 2 });
    pointer("pointerMove", paper(), "touch", 300, 200, { pointerId: 1 });
    pointer("pointerMove", paper(), "touch", 100, 100, { pointerId: 2 });
    pointer("pointerMove", paper(), "pen", 150, 300, { pointerId: 9, pressure: 0.5 });
    pointer("pointerUp", paper(), "pen", 150, 300, { pointerId: 9 });
    expect(layer().style.transform).toBe("translate(0px, 0px) scale(1)");
    expect(strokes()).toHaveLength(1);

    // The pen is up, but those palms stay ignored until they lift.
    pointer("pointerMove", paper(), "touch", 0, 0, { pointerId: 1 });
    pointer("pointerDown", paper(), "touch", 400, 400, { pointerId: 3 });
    pointer("pointerMove", paper(), "touch", 0, 0, { pointerId: 2 });
    expect(layer().style.transform).toBe("translate(0px, 0px) scale(1)");
    pointer("pointerUp", paper(), "touch", 0, 0, { pointerId: 1 });
    pointer("pointerUp", paper(), "touch", 0, 0, { pointerId: 2 });

    // A new touch, down after the pen lifted, pans.
    pointer("pointerMove", paper(), "touch", 450, 400, { pointerId: 3 });
    expect(layer().style.transform).toBe("translate(50px, 0px) scale(1)");
  });

  test("a pan or a pinch under way is cancelled when the pen lands", async () => {
    layOut({ canvas: { w: 800, h: 600 }, natural: 120 });
    renderScreen();
    await shown();

    pointer("pointerDown", paper(), "touch", 100, 100, { pointerId: 1 });
    pointer("pointerDown", paper(), "touch", 200, 100, { pointerId: 2 });
    pointer("pointerMove", paper(), "touch", 50, 100, { pointerId: 1 });
    const pinched = layer().style.transform;
    expect(pinched).not.toBe("translate(0px, 0px) scale(1)");

    pointer("pointerDown", paper(), "pen", 300, 300, { pointerId: 9, pressure: 0.5 });
    pointer("pointerMove", paper(), "touch", 0, 100, { pointerId: 1 });
    pointer("pointerMove", paper(), "touch", 400, 100, { pointerId: 2 });
    pointer("pointerUp", paper(), "pen", 300, 300, { pointerId: 9 });
    pointer("pointerMove", paper(), "touch", 500, 100, { pointerId: 2 });
    expect(layer().style.transform).toBe(pinched);
  });

  test("a finger moving the selected Front stops when the pen lands", async () => {
    layOut({ canvas: { w: 800, h: 600 }, natural: 120 });
    renderScreen();
    await shown();
    tap(front(), "touch");

    pointer("pointerDown", front(), "touch", 100, 100, { pointerId: 1 });
    pointer("pointerMove", front(), "touch", 120, 100, { pointerId: 1 });
    expect(front().style.left).toBe("32px");
    pointer("pointerDown", paper(), "pen", 300, 300, { pointerId: 9, pressure: 0.5 });
    pointer("pointerMove", front(), "touch", 400, 400, { pointerId: 1 });
    pointer("pointerUp", paper(), "pen", 300, 300, { pointerId: 9 });
    pointer("pointerMove", front(), "touch", 500, 500, { pointerId: 1 });
    expect(front().style.left).toBe("32px");
    expect(front().style.top).toBe("28px");
  });
});

describe("while the pen writes", () => {
  test("a palm on the zoom control zooms nothing, then or when it lifts", async () => {
    layOut({ canvas: { w: 800, h: 600 }, natural: 120 });
    renderScreen();
    await shown();

    pointer("pointerDown", paper(), "pen", 100, 300);
    pointer("pointerDown", zoomIn(), "touch", 10, 10, { pointerId: 1 });
    fireEvent.click(zoomIn());
    pointer("pointerMove", paper(), "pen", 150, 300);
    pointer("pointerUp", paper(), "pen", 150, 300);
    // It lifts after the pen, and its click comes then.
    pointer("pointerUp", zoomIn(), "touch", 10, 10, { pointerId: 1 });
    act(
      () => void zoomIn().dispatchEvent(new PointerEvent("click", { bubbles: true, pointerId: 1 })),
    );

    expect(zoomReadout().textContent).toBe("100%");
    expect(strokes()).toHaveLength(1);
    // A tap that is no palm still zooms.
    fireEvent.click(zoomIn());
    expect(zoomReadout().textContent).toBe("125%");
  });

  test("the view never moves under a Stroke: Fit and the mouse on the zoom control wait", async () => {
    layOut({ canvas: { w: 800, h: 600 }, natural: 120 });
    renderScreen();
    await shown();

    pointer("pointerDown", paper(), "pen", 100, 300);
    fireEvent.click(zoomIn());
    fireEvent.click(screen.getByRole("button", { name: "Fit" }));
    wheel({ deltaY: 100 });
    expect(layer().style.transform).toBe("translate(0px, 0px) scale(1)");
    pointer("pointerUp", paper(), "pen", 100, 300);
  });

  test("a Stroke whose lift never came ends when the pen lands again, and the Canvas works on", async () => {
    layOut({ canvas: { w: 800, h: 600 }, natural: 120 });
    renderScreen();
    await shown();

    pointer("pointerDown", paper(), "pen", 100, 300, { pointerId: 9 });
    pointer("pointerMove", paper(), "pen", 150, 300, { pointerId: 9 });
    write(paper(), [
      [100, 400, 0.5],
      [150, 400, 0.5],
    ]);
    // write() uses the same id; a new pen id ends the stale one too.
    pointer("pointerDown", paper(), "pen", 100, 300, { pointerId: 11 });
    pointer("pointerDown", paper(), "pen", 100, 500, { pointerId: 12 });
    pointer("pointerUp", paper(), "pen", 100, 500, { pointerId: 12 });
    expect(strokes()).toHaveLength(3);

    drag(paper(), "touch", [100, 100], [150, 100]);
    expect(layer().style.transform).toBe("translate(50px, 0px) scale(1)");
  });

  test("a Stroke whose pen loses its capture, or the window its focus, ends there", async () => {
    layOut({ canvas: { w: 800, h: 600 }, natural: 120 });
    renderScreen();
    await shown();

    pointer("pointerDown", paper(), "pen", 100, 300);
    fireEvent.lostPointerCapture(viewport(), { pointerId: 9, pointerType: "pen" });
    expect(strokes()).toHaveLength(1);
    pointer("pointerDown", paper(), "pen", 100, 300);
    act(() => void window.dispatchEvent(new Event("blur")));
    expect(strokes()).toHaveLength(2);

    expect(wheel({ deltaY: 100 })).toBe(false);
    expect(layer().style.transform).toBe("translate(0px, -100px) scale(1)");
  });

  test("the lift's own sample is kept", async () => {
    layOut({ canvas: { w: 800, h: 600 }, natural: 120 });
    renderScreen();
    await shown();

    pointer("pointerDown", paper(), "pen", 100, 300, { pressure: 0.5 });
    pointer("pointerMove", paper(), "pen", 120, 300, { pressure: 0.5 });
    pointer("pointerUp", paper(), "pen", 300, 300, { pressure: 0 });
    expect(Math.max(...xs(strokes()[0]!.getAttribute("d")!))).toBeGreaterThan(290);
  });
});

describe("a pinch from the Front", () => {
  test("a finger moving the selected Front and one on the paper pinch, and the Front stops", async () => {
    layOut({ canvas: { w: 800, h: 600 }, natural: 120 });
    renderScreen();
    await shown();
    tap(front(), "touch");

    pointer("pointerDown", front(), "touch", 100, 100, { pointerId: 1 });
    pointer("pointerDown", paper(), "touch", 200, 100, { pointerId: 2 });
    pointer("pointerMove", front(), "touch", 50, 100, { pointerId: 1 });
    pointer("pointerMove", paper(), "touch", 250, 100, { pointerId: 2 });

    expect(zoomReadout().textContent).toBe("200%");
    expect(front().style.left).toBe("12px");
  });
});
