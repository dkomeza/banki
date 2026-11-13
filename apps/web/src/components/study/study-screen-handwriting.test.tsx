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
        <StudyScreen deck={deck} handwriting={hand} />
      </RouterContextProvider>
    </QueryClientProvider>
  );
  const { rerender } = render(ui(handwriting));
  return { router, setHandwriting: (hand: boolean) => rerender(ui(hand)) };
}

const tools = () => screen.queryByRole("toolbar", { name: "Handwriting tools" });
const check = () => screen.getByRole<HTMLButtonElement>("button", { name: /Check/ });
const dontKnow = () => screen.getByRole<HTMLButtonElement>("button", { name: "I don't know" });
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

  test("the tool bar's controls are named and disabled, and so is the zoom", async () => {
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
    for (const name of ["Zoom out", "Zoom 100%", "Zoom in", "Fit"]) {
      expect(screen.getByRole<HTMLButtonElement>("button", { name }).disabled).toBe(true);
    }
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
    fireEvent.pointerDown(front(), { pointerId: 1, button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerUp(front(), { pointerId: 1 });
    const corners = front().querySelectorAll("[data-corner]");
    expect(corners).toHaveLength(4);

    // The bottom-right corner, dragged out by its width (187 px at 45%): twice the size.
    const br = corners[3]!;
    fireEvent.pointerDown(br, { pointerId: 2, button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(br, { pointerId: 2, clientX: 416 * 0.45, clientY: 0 });
    fireEvent.pointerUp(br, { pointerId: 2 });
    expect(frontScale()).toBeCloseTo(0.9);

    // Tapping the paper lets go of it.
    fireEvent.pointerDown(screen.getByRole("img", { name: "Handwritten answer" }));
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

  test("a Front taller than the canvas, even at 40%, drags up until its end shows", async () => {
    layOut({ canvas: { w: 1440, h: 600 }, natural: 4000 });
    renderScreen();
    await shown();
    // At 40%, 1600 px tall on a 600 px canvas.
    expect(frontScale()).toBe(0.4);

    fireEvent.pointerDown(front(), { pointerId: 1, button: 0, clientX: 100, clientY: 500 });
    fireEvent.pointerMove(front(), { pointerId: 1, clientX: 100, clientY: -700 });
    fireEvent.pointerUp(front(), { pointerId: 1 });
    expect(front().style.top).toBe("-1172px");

    // No further than leaves 48 px of it on the canvas.
    fireEvent.pointerDown(front(), { pointerId: 2, button: 0, clientX: 100, clientY: 500 });
    fireEvent.pointerMove(front(), { pointerId: 2, clientX: 100, clientY: -5000 });
    fireEvent.pointerUp(front(), { pointerId: 2 });
    expect(front().style.top).toBe("-1552px");
  });

  test("drags and arrow keys move it, but never off the canvas", async () => {
    layOut({ canvas: { w: 800, h: 600 }, natural: 120 });
    renderScreen();
    await shown();
    expect(front().style.left).toBe("12px");
    expect(front().style.top).toBe("28px");

    fireEvent.pointerDown(front(), { pointerId: 1, button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(front(), { pointerId: 1, clientX: 150, clientY: 120 });
    fireEvent.pointerUp(front(), { pointerId: 1 });
    expect(front().style.left).toBe("62px");
    expect(front().style.top).toBe("48px");

    act(() => front().focus());
    fireEvent.keyDown(front(), { key: "ArrowLeft" });
    fireEvent.keyDown(front(), { key: "ArrowUp", shiftKey: true });
    expect(front().style.left).toBe("54px");
    expect(front().style.top).toBe("8px");

    fireEvent.pointerDown(front(), { pointerId: 3, button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(front(), { pointerId: 3, clientX: 5000, clientY: 5000 });
    fireEvent.pointerUp(front(), { pointerId: 3 });
    expect(front().style.left).toBe("752px");
    expect(front().style.top).toBe("552px");
  });
});
