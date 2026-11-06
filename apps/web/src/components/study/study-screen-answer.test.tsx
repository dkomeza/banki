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

const pointer = vi.hoisted(() => ({ fine: true }));
vi.mock("@/components/folders/drag", () => ({ useFinePointer: () => pointer.fine }));

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

/** A Rating saved, as the API answers it. */
const saved = async (cardId: string) =>
  json(
    {
      review: {
        id: `r-${cardId}`,
        cardId,
        deckId: "d1",
        reviewedAt: "2026-05-01T09:00:00.000Z",
        rating: "again",
        kind: "self-rated",
        durationMs: 0,
      },
      schedule,
    },
    201,
  );

/** The Grader's grade of "breakfast $x$, lunch", as the API answers it. */
const GRADED = {
  rating: "good",
  feedback: "Mostly right: the **dinner** is missing.",
  missing: [{ from: 0, to: 2 }],
  mistakes: [
    { from: 0, to: 9, note: "Not breakfast." },
    { from: 11, to: 12, note: "Not $x$." },
  ],
};

let queue: string[] = [];
let rated: { cardId: string; body: unknown }[] = [];
let rate: (cardId: string) => Promise<Response>;
let graded: { cardId: string; body: unknown }[] = [];
let grade: (cardId: string) => Promise<Response>;

beforeEach(() => {
  pointer.fine = true;
  queue = ["c1", "c2"];
  rated = [];
  rate = saved;
  graded = [];
  grade = async () => json(GRADED);
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
      return rate(cardId);
    }
    const grading = path.match(/^\/api\/cards\/(\w+)\/grade$/);
    if (grading !== null) {
      const cardId = grading[1] ?? "";
      graded.push({ cardId, body: await request.clone().json() });
      return grade(cardId);
    }
    // Re-read as a stored Session resumes.
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
  localStorage.clear();
});

function renderScreen(deck: Deck = DECK) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(settingsQueryOptions().queryKey, { settings: SETTINGS, issuedAt: 0 });
  const router = createRouter({ routeTree: createRootRoute(), history: createMemoryHistory() });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterContextProvider router={router}>
        <StudyScreen deck={deck} />
      </RouterContextProvider>
    </QueryClientProvider>,
  );
  return router;
}

/** The answer editor, once the Card shows. */
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

/** Types `text` at the end of the answer, as the User would. */
function type(view: EditorView, text: string) {
  act(() => view.dispatch({ changes: { from: view.state.doc.length, insert: text } }));
}

const check = () => screen.getByRole<HTMLButtonElement>("button", { name: /Check/ });
const dontKnow = () => screen.getByRole<HTMLButtonElement>("button", { name: "I don't know" });
const press = (target: Element | Document, key: string, init: KeyboardEventInit = {}) =>
  fireEvent.keyDown(target, { key, bubbles: true, ...init });

describe("write-and-grade on the study screen", () => {
  test("shows the answer editor under the Front, with I don't know and Check, and no Show answer", async () => {
    renderScreen();
    await answerEditor();

    expect(screen.getByText("c1 front")).toBeTruthy();
    expect(screen.getByText("Your answer")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Show answer/ })).toBeNull();
    expect(dontKnow().disabled).toBe(false);
    expect(check().disabled).toBe(true);
    // The cheatsheet is there; Images aren't.
    expect(screen.getByRole("button", { name: "LaTeX cheatsheet" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Image" })).toBeNull();
  });

  test("the Write toggle is pressed in write-and-grade, and switches to self-rate keeping the draft", async () => {
    renderScreen();
    const view = await answerEditor();
    type(view, "half");
    const toggle = screen.getByRole<HTMLButtonElement>("button", { name: "Write and grade" });
    expect(toggle.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: /Show answer/ })).toBeTruthy();
    expect(document.querySelector("[data-answer-editor]")).toBeNull();

    fireEvent.click(toggle);
    const back = await answerEditor();
    expect(back.state.doc.toString()).toBe("half");
  });

  test("is focused as the Card shows with a fine pointer, and not on touch", async () => {
    renderScreen();
    const view = await answerEditor();
    expect(view.hasFocus || document.activeElement === view.contentDOM).toBe(true);
    cleanup();
    localStorage.clear();

    pointer.fine = false;
    queue = ["c1"];
    renderScreen();
    const touch = await answerEditor();
    expect(document.activeElement === touch.contentDOM).toBe(false);
  });

  test("Check waits for an answer that isn't blank, then shows it, the Back and the ratings", async () => {
    renderScreen();
    const view = await answerEditor();
    type(view, "   \n ");
    expect(check().disabled).toBe(true);

    type(view, "breakfast");
    expect(check().disabled).toBe(false);
    fireEvent.click(check());

    const slip = screen.getByRole("region", { name: "Your answer" });
    expect(slip.textContent).toContain("breakfast");
    expect(screen.getByText("c1 back")).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Good/ })).toBeTruthy();
    expect(document.querySelector("[data-answer-editor]")).toBeNull();

    // The Rating saves as any, once the suggestion is in: self-rated, and the next Card starts blank.
    await screen.findByText(/Suggests/);
    press(document.body, "3");
    await waitFor(() => expect(rated).toHaveLength(1));
    expect(rated[0]).toMatchObject({ cardId: "c1", body: { rating: "good" } });
    const nextEditor = await waitFor(async () => {
      expect(screen.getByText("c2 front")).toBeTruthy();
      return answerEditor();
    });
    expect(nextEditor.state.doc.toString()).toBe("");
  });

  test("Ctrl+Enter in the answer editor checks", async () => {
    renderScreen();
    const view = await answerEditor();
    type(view, "breakfast");

    press(view.contentDOM, "Enter", { ctrlKey: true });

    await waitFor(() => expect(screen.getByText("c1 back")).toBeTruthy());
    expect(screen.getByRole("region", { name: "Your answer" })).toBeTruthy();
  });

  test("a tap on the Card, or Space, reveals nothing", async () => {
    renderScreen();
    await answerEditor();

    fireEvent.click(screen.getByText("c1 front"));
    press(document.body, " ");
    press(document.body, "Enter");

    expect(screen.queryByText("c1 back")).toBeNull();
    expect(screen.queryByText("Tap anywhere to reveal")).toBeNull();
  });

  test("while the answer editor has focus, the study keys are off, and Esc leaves the field first", async () => {
    const router = renderScreen();
    const view = await answerEditor();
    const before = router.history.location.pathname;

    for (const key of ["e", " ", "1", "z"]) press(view.contentDOM, key);
    press(view.contentDOM, "z", { ctrlKey: true });
    expect(screen.queryByText("c1 back")).toBeNull();
    expect(document.querySelector("[data-study-editor]")).toBeNull();

    press(view.contentDOM, "Escape");
    expect(router.history.location.pathname).toBe(before);

    press(view.contentDOM, "Escape");
    await waitFor(() => expect(router.history.location.pathname).toBe("/decks/d1"));
  });

  test("a key between the two Escs leaves the field again first", async () => {
    const router = renderScreen();
    const view = await answerEditor();
    const before = router.history.location.pathname;

    press(view.contentDOM, "Escape");
    press(view.contentDOM, "a");
    press(view.contentDOM, "Escape");

    expect(router.history.location.pathname).toBe(before);
  });
});

describe("I don't know on the study screen", () => {
  test("saves Again at once, and shows the Back with Next, which Enter presses", async () => {
    renderScreen();
    const view = await answerEditor();
    type(view, "no idea");

    fireEvent.click(dontKnow());

    await waitFor(() => expect(screen.getByText(/Saved as/)).toBeTruthy());
    expect(rated).toEqual([{ cardId: "c1", body: expect.objectContaining({ rating: "again" }) }]);
    expect(screen.getByText("c1 back")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Your answer" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Good/ })).toBeNull();

    press(document.body, "Enter");
    await waitFor(() => expect(screen.getByText("c2 front")).toBeTruthy());
    expect((await answerEditor()).state.doc.toString()).toBe("");
  });

  test("is disabled while it saves, and a failure says so with Try again", async () => {
    const pending: ((response: Response) => void)[] = [];
    const answer = (response: Response) => pending.shift()?.(response);
    rate = () =>
      new Promise((resolve) => {
        pending.push(resolve);
      });
    renderScreen();
    await answerEditor();

    fireEvent.click(dontKnow());
    await waitFor(() => expect(rated).toHaveLength(1));
    const next = screen.getByRole<HTMLButtonElement>("button", { name: /Saving|Next/ });
    expect(next.disabled).toBe(true);
    await act(async () => answer(new Response(null, { status: 500 })));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("rating"));
    expect(screen.queryByText(/Saved as/)).toBeNull();
    rate = saved;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByText(/Saved as/)).toBeTruthy());
    expect(rated).toHaveLength(2);
  });

  test("a Card deleted elsewhere says so, and the next Card shows", async () => {
    rate = async () => json({ error: { code: "not_found", message: "Not found" } }, 404);
    renderScreen();
    await answerEditor();

    fireEvent.click(dontKnow());

    await waitFor(() => expect(screen.getByText("c2 front")).toBeTruthy());
  });
});

/** A response the test answers when it likes. */
function held() {
  const box: { answer?: (response: Response) => void } = {};
  const response = new Promise<Response>((resolve) => {
    box.answer = resolve;
  });
  return { response, answer: (r: Response) => act(async () => box.answer?.(r)) };
}

/** Renders the screen and checks the first Card with `answer`. */
async function checkWith(answer = "breakfast $x$, lunch") {
  const router = renderScreen();
  const view = await answerEditor();
  type(view, answer);
  fireEvent.click(check());
  return router;
}

const rating = (name: string) =>
  screen.getByRole<HTMLButtonElement>("button", { name: new RegExp(`^${name}`) });
/** The mistakes marked in your answer. */
const marks = () =>
  screen
    .getByRole("region", { name: "Your answer" })
    .querySelectorAll<HTMLElement>('mark[data-highlight="mistake"]');
const edit = () => screen.getByRole<HTMLButtonElement>("button", { name: /^Edit/ });

describe("the Grader's result on the study screen", () => {
  test("Check sends the Written answer; while the Grader works it says so, and Edit waits", async () => {
    const pending = held();
    grade = () => pending.response;
    await checkWith();

    await waitFor(() => expect(graded).toHaveLength(1));
    expect(graded[0]).toEqual({ cardId: "c1", body: { answer: "breakfast $x$, lunch" } });
    expect(screen.getByRole("status", { name: "Grading your answer" })).toBeTruthy();
    expect(edit().disabled).toBe(true);

    await pending.answer(json(GRADED));
    expect(screen.queryByRole("status", { name: "Grading your answer" })).toBeNull();
    expect(edit().disabled).toBe(false);
  });

  test("the result fills in the Feedback, the Highlights and the marked suggestion", async () => {
    await checkWith();

    await screen.findByText(/Suggests/);
    const feedback = screen.getByRole("complementary", { name: "Feedback" });
    expect(feedback.textContent).toContain("Mostly right: the dinner is missing.");
    expect(feedback.querySelector("strong")?.textContent).toBe("dinner");
    expect(rating("Good").getAttribute("aria-label")).toContain("suggested");
    expect(rating("Hard").getAttribute("aria-label")).not.toContain("suggested");
    const back = screen.getByRole("region", { name: "Answer" });
    expect(back.querySelector('mark[data-highlight="missing"]')?.textContent).toBe("c1");
    const yours = screen.getByRole("region", { name: "Your answer" });
    expect(yours.textContent).toContain("2 mistakes");
    const mistakes = yours.querySelectorAll('mark[data-highlight="mistake"]');
    expect([...mistakes].map((m) => m.getAttribute("data-n"))).toEqual(["0", "1"]);
    // The second covers a Formula: marked whole.
    expect(mistakes[1]?.hasAttribute("data-whole")).toBe(true);
  });

  test("a mistake opens its note on a tap, one on a Formula too, and Escape puts it away", async () => {
    await checkWith();
    await screen.findByText(/Suggests/);

    fireEvent.click(marks()[0] ?? document.body);
    expect(screen.getByRole("note").textContent).toContain("Not breakfast.");
    expect(marks()[0]?.getAttribute("aria-expanded")).toBe("true");

    // A tap on the Formula's own glyphs, inside the mark.
    fireEvent.pointerDown(marks()[1]?.querySelector(".katex") ?? document.body);
    fireEvent.click(marks()[1]?.querySelector(".katex") ?? document.body);
    expect(screen.getByRole("note").querySelector(".katex")).toBeTruthy();
    expect(marks()[1]?.getAttribute("aria-expanded")).toBe("true");

    press(document.body, "Escape");
    expect(screen.queryByRole("note")).toBeNull();
  });

  test("a mistake's note opens while it has the focus, and goes when the focus leaves", async () => {
    await checkWith();
    await screen.findByText(/Suggests/);
    const [first, second] = marks();
    expect(first?.tabIndex).toBe(0);
    expect(first?.getAttribute("aria-label")).toBe("Mistake 1 of 2: show why");

    act(() => second?.focus());
    expect(screen.getByRole("note").getAttribute("data-mistake-note")).toBe("1");
    act(() => second?.blur());
    await waitFor(() => expect(screen.queryByRole("note")).toBeNull());
  });

  test("a mistake with nothing to mark has its note listed under your answer", async () => {
    // "**" alone: markup, which renders as nothing.
    grade = async () =>
      json({ ...GRADED, mistakes: [{ from: 0, to: 2, note: "Only markup here." }] });
    await checkWith("**breakfast**");
    await screen.findByText(/Suggests/);

    expect(marks()).toHaveLength(0);
    const others = await screen.findByRole("list", { name: "Other mistakes" });
    expect(others.textContent).toContain("Only markup here.");
  });

  test("before the suggestion, a tap selects and Confirm saves the selection", async () => {
    const pending = held();
    grade = () => pending.response;
    await checkWith();
    await waitFor(() => expect(graded).toHaveLength(1));

    fireEvent.click(rating("Hard"));
    expect(rated).toEqual([]);
    expect(rating("Hard").getAttribute("aria-pressed")).toBe("true");
    press(document.body, "4");
    expect(rated).toEqual([]);
    expect(rating("Easy").getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: /Confirm Easy/ }));
    await waitFor(() => expect(rated).toHaveLength(1));
    expect(rated[0]).toMatchObject({ cardId: "c1", body: { rating: "easy" } });
    await pending.answer(json(GRADED));
    await waitFor(() => expect(screen.getByText("c2 front")).toBeTruthy());
  });

  test("before the suggestion, Enter with nothing selected does nothing, and with one saves it", async () => {
    const pending = held();
    grade = () => pending.response;
    await checkWith();
    await waitFor(() => expect(graded).toHaveLength(1));

    press(document.body, "Enter");
    expect(rated).toEqual([]);
    press(document.body, "1");
    press(document.body, "Enter");
    await waitFor(() => expect(rated).toHaveLength(1));
    expect(rated[0]).toMatchObject({ body: { rating: "again" } });
  });

  test("a selection survives the suggestion's arrival, and Enter saves it", async () => {
    const pending = held();
    grade = () => pending.response;
    await checkWith();
    await waitFor(() => expect(graded).toHaveLength(1));
    press(document.body, "2");

    await pending.answer(json(GRADED));
    await screen.findByText(/Suggests/);
    expect(screen.queryByRole("button", { name: /Confirm/ })).toBeNull();
    press(document.body, "Enter");
    await waitFor(() => expect(rated).toHaveLength(1));
    expect(rated[0]).toMatchObject({ body: { rating: "hard" } });
  });

  test("after the suggestion, Enter saves it, and a tap saves any Rating at once", async () => {
    await checkWith();
    await screen.findByText(/Suggests/);
    press(document.body, "Enter");
    await waitFor(() => expect(rated).toHaveLength(1));
    expect(rated[0]).toMatchObject({ body: { rating: "good" } });

    const view = await waitFor(async () => {
      expect(screen.getByText("c2 front")).toBeTruthy();
      return answerEditor();
    });
    type(view, "dinner");
    fireEvent.click(check());
    await screen.findByText(/Suggests/);
    fireEvent.click(rating("Again"));
    await waitFor(() => expect(rated).toHaveLength(2));
    expect(rated[1]).toMatchObject({ cardId: "c2", body: { rating: "again" } });
  });

  test("409: the API-key message with a link to Settings, and one-tap ratings", async () => {
    grade = async () => json({ error: { code: "no_api_key", message: "No key" } }, 409);
    await checkWith();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(
      "Add your OpenRouter API key in Settings to grade answers.",
    );
    expect(screen.getByRole("button", { name: "Open Settings" }).getAttribute("href")).toBe(
      "/settings",
    );
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    fireEvent.click(rating("Hard"));
    await waitFor(() => expect(rated).toHaveLength(1));
  });

  test("502: its message with Try again, which sends the same Written answer again", async () => {
    grade = async () => json({ error: { code: "grading_failed", message: "No" } }, 502);
    await checkWith();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(
      "Couldn't grade this answer. Try again, or rate it yourself.",
    );
    grade = async () => json(GRADED);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByText(/Suggests/);
    expect(graded.map((g) => g.body)).toEqual([
      { answer: "breakfast $x$, lunch" },
      { answer: "breakfast $x$, lunch" },
    ]);
  });

  test("a network error says Banki can't be reached, with Try again", async () => {
    grade = async () => {
      throw new TypeError("Failed to fetch");
    };
    await checkWith();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Can't reach Banki");
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  test("404: the Card was deleted elsewhere, so the next Card shows", async () => {
    grade = async () => json({ error: { code: "not_found", message: "Card not found" } }, 404);
    await checkWith();

    await waitFor(() => expect(screen.getByText("c2 front")).toBeTruthy());
    expect(rated).toEqual([]);
  });

  test("a reload resumes the Card with its result, without asking the Grader again", async () => {
    await checkWith();
    await screen.findByText(/Suggests/);
    cleanup();
    queue = ["c1", "c2"];

    renderScreen();
    await screen.findByText(/Suggests/);
    expect(graded).toHaveLength(1);
    expect(screen.getByRole("region", { name: "Your answer" }).textContent).toContain("breakfast");
  });
});
