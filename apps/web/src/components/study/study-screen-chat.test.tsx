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
import { DeckMacros } from "@/components/cards/deck-macros";
import type { Card } from "@/lib/cards";
import type { Deck } from "@/lib/decks";
import { settingsQueryOptions } from "@/lib/settings";
import { StudyScreen } from "./study-screen";

// The Follow-up chat on the study screen, with the API stubbed: the grade
// route answers a grade, and the chat route streams what each test sends.

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
  macros: [{ name: "\\dd", definition: "\\mathrm{d}" }],
  answerMode: "write",
};

const SETTINGS: SettingsResponse = {
  timezone: "Europe/Warsaw",
  dayStartHour: 4,
  model: "anthropic/claude-haiku-5.5",
  apiKey: { state: "set", lastFour: "3f9a" },
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

const GRADED = {
  rating: "hard",
  feedback: "Close: the **constant** is missing.",
  missing: [],
  mistakes: [],
};

const encoder = new TextEncoder();
const line = (chunk: unknown) => encoder.encode(`${JSON.stringify(chunk)}\n`);

/** A whole reply, `pieces` and then its end. */
const replied = (...pieces: string[]) =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const text of pieces) controller.enqueue(line({ text }));
        controller.enqueue(line({ end: true }));
        controller.close();
      },
    }),
  );

/** A reply the test streams, piece by piece, then ends or breaks off. */
function streaming() {
  const box: { controller?: ReadableStreamDefaultController<Uint8Array> } = {};
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        box.controller = controller;
      },
    }),
  );
  return {
    response,
    send: (text: string) => act(async () => box.controller?.enqueue(line({ text }))),
    end: () =>
      act(async () => {
        box.controller?.enqueue(line({ end: true }));
        box.controller?.close();
      }),
    breakOff: () => act(async () => box.controller?.close()),
  };
}

let queue: string[] = [];
let rated: { cardId: string; body: unknown }[] = [];
let asked: { cardId: string; body: { messages: { role: string; text: string }[] } }[] = [];
let chat: () => Promise<Response> | Response;

beforeEach(() => {
  pointer.fine = true;
  queue = ["c1", "c2"];
  rated = [];
  asked = [];
  chat = () => replied("Because ", "$\\dd x$ is the step.");
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
            rating: "hard",
            kind: "self-rated",
            durationMs: 0,
          },
          schedule,
        },
        201,
      );
    }
    if (/^\/api\/cards\/\w+\/grade$/.test(path)) return json(GRADED);
    const chatting = path.match(/^\/api\/cards\/(\w+)\/chat$/);
    if (chatting !== null) {
      asked.push({ cardId: chatting[1] ?? "", body: await request.clone().json() });
      return chat();
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
  localStorage.clear();
});

function renderScreen() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(settingsQueryOptions().queryKey, { settings: SETTINGS, issuedAt: 0 });
  const router = createRouter({ routeTree: createRootRoute(), history: createMemoryHistory() });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterContextProvider router={router}>
        {/* As the study route renders it: with the Deck's Macros. */}
        <DeckMacros own={DECK.macros}>
          <StudyScreen deck={DECK} />
        </DeckMacros>
      </RouterContextProvider>
    </QueryClientProvider>,
  );
  return router;
}

/** The editor inside `selector`, once it shows. */
async function editorIn(selector: string): Promise<EditorView> {
  const editor = await waitFor(() => {
    const found = document.querySelector(`${selector} .cm-editor`);
    if (!(found instanceof HTMLElement)) throw new Error(`No editor in ${selector} yet`);
    return found;
  });
  const view = EditorView.findFromDOM(editor);
  if (view === null) throw new Error("No view");
  return view;
}

/** Types `text` at the end of the field, as the User would. */
function type(view: EditorView, text: string) {
  act(() => view.dispatch({ changes: { from: view.state.doc.length, insert: text } }));
}

const press = (target: Element | Document, key: string, init: KeyboardEventInit = {}) =>
  fireEvent.keyDown(target, { key, bubbles: true, ...init });

/** Renders the screen, checks the first Card, and waits for its grade: the chat's field. */
async function gradedScreen() {
  const router = renderScreen();
  type(await editorIn("[data-answer-editor]"), "an answer");
  fireEvent.click(screen.getByRole("button", { name: /Check/ }));
  await screen.findByText(/Suggests/);
  return { router, field: await editorIn("[data-chat-input]") };
}

/** Types `question` in the chat and sends it with Ctrl+Enter. */
function ask(field: EditorView, question: string) {
  type(field, question);
  press(field.contentDOM, "Enter", { ctrlKey: true });
}

const send = () => screen.queryByRole<HTMLButtonElement>("button", { name: "Send" });
const stop = () => screen.queryByRole<HTMLButtonElement>("button", { name: "Stop" });
const log = () => screen.getByRole("log", { name: "Follow-up chat" });
const edit = () => screen.getByRole<HTMLButtonElement>("button", { name: /^Edit/ });

describe("the Follow-up chat on the study screen", () => {
  test("is offered in the Feedback card once the grade is in, and not while grading", async () => {
    const grader: { answer?: (r: Response) => void } = {};
    const pending = new Promise<Response>((resolve) => {
      grader.answer = resolve;
    });
    const fetchStub = globalThis.fetch;
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      return url.endsWith("/grade") ? pending : fetchStub(input, init);
    });
    renderScreen();
    type(await editorIn("[data-answer-editor]"), "an answer");
    fireEvent.click(screen.getByRole("button", { name: /Check/ }));
    await screen.findByRole("status", { name: "Grading your answer" });
    expect(document.querySelector("[data-chat-input]")).toBeNull();

    await act(async () => grader.answer?.(json(GRADED)));

    const feedback = await screen.findByRole("region", { name: "Feedback and follow-up chat" });
    expect(feedback.textContent).toContain("Close: the constant is missing.");
    expect(feedback.querySelector("[data-chat-input]")).not.toBeNull();
    expect(feedback.textContent).toContain("never changes its suggestion");
    expect(send()?.disabled).toBe(true);
  });

  test("not after a failure: the failure shows in the Feedback's place, without a field", async () => {
    const fetchStub = globalThis.fetch;
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      return url.endsWith("/grade")
        ? json({ error: { code: "grading_failed", message: "x" } }, 502)
        : fetchStub(input, init);
    });
    renderScreen();
    type(await editorIn("[data-answer-editor]"), "an answer");
    fireEvent.click(screen.getByRole("button", { name: /Check/ }));

    await screen.findByRole("alert");
    expect(document.querySelector("[data-chat-input]")).toBeNull();
  });

  test("Ctrl+Enter sends the question, Enter is a new line, and the reply streams in with LaTeX and the Deck's Macros", async () => {
    const reply = streaming();
    chat = () => reply.response;
    const { field } = await gradedScreen();
    const placeholder = () => field.dom.querySelector(".cm-placeholder")?.textContent;
    expect(placeholder()).toBe("Ask about this Feedback…");

    press(field.contentDOM, "Enter");
    expect(field.state.doc.toString()).toBe("\n");
    type(field, "Why is that wrong?");
    press(field.contentDOM, "Enter");
    expect(asked).toEqual([]);
    press(field.contentDOM, "Enter", { ctrlKey: true });

    await waitFor(() => expect(asked).toHaveLength(1));
    expect(asked[0]?.body.messages).toEqual([{ role: "user", text: "\n\nWhy is that wrong?" }]);
    expect(field.state.doc.toString()).toBe("");
    expect(screen.getByRole("status", { name: "Answering" })).toBeTruthy();

    await reply.send("**Because** $\\dd x$");
    await waitFor(() => expect(log().textContent).toContain("Because"));
    expect(log().querySelector("strong")?.textContent).toBe("Because");
    // \dd, the Deck's Macro, typeset as \mathrm{d}.
    expect(log().querySelector(".katex .mathrm")?.textContent).toBe("d");
    expect(log().querySelector("[aria-busy=true]")).not.toBeNull();
    expect(send()).toBeNull();
    expect(stop()).not.toBeNull();
    expect(edit().disabled).toBe(true);

    await reply.send(" is the step.");
    await reply.end();
    await waitFor(() => expect(send()).not.toBeNull());
    expect(log().textContent).toContain("is the step.");
    expect(log().querySelector("[aria-busy=true]")).toBeNull();
    expect(edit().disabled).toBe(false);
    expect(placeholder()).toBe("Ask a follow-up…");
  });

  test("Send sends too, and is disabled while a reply streams", async () => {
    const reply = streaming();
    chat = () => reply.response;
    const { field } = await gradedScreen();
    type(field, "Why?");

    fireEvent.click(send() ?? document.body);
    await waitFor(() => expect(asked).toHaveLength(1));
    type(field, "And then?");
    press(field.contentDOM, "Enter", { ctrlKey: true });
    await reply.send("Because.");

    expect(asked).toHaveLength(1);
    expect(stop()).not.toBeNull();
  });

  test("in the field, 1–4, Enter and Space type and don't rate; out of it, the study keys work", async () => {
    const { field } = await gradedScreen();

    for (const key of ["1", "2", "3", "4", " ", "Enter", "e"]) press(field.contentDOM, key);
    expect(rated).toEqual([]);
    expect(document.querySelector("[data-study-editor]")).toBeNull();

    press(document.body, "3");
    await waitFor(() => expect(rated).toHaveLength(1));
  });

  test("Esc leaves the field first, and a second leaves", async () => {
    const { router, field } = await gradedScreen();
    const before = router.history.location.pathname;

    press(field.contentDOM, "Escape");
    expect(router.history.location.pathname).toBe(before);

    press(field.contentDOM, "Escape");
    await waitFor(() => expect(router.history.location.pathname).toBe("/decks/d1"));
  });

  test("Stop ends the reply, keeping what came", async () => {
    const reply = streaming();
    chat = () => reply.response;
    const { field } = await gradedScreen();
    ask(field, "Why?");
    await reply.send("Because the");
    await waitFor(() => expect(stop()).not.toBeNull());

    fireEvent.click(stop() ?? document.body);
    await reply.send(" late piece");

    await waitFor(() => expect(send()).not.toBeNull());
    expect(log().textContent).toContain("Because the");
    expect(log().textContent).not.toContain("late piece");
  });

  test("a failed reply shows at its place with its message and action, and Try again asks again in its place", async () => {
    chat = () => json({ error: { code: "grading_failed", message: "x" } }, 502);
    const { field } = await gradedScreen();
    ask(field, "Why?");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Couldn't answer. Try again.");
    chat = () => replied("Because.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => expect(log().textContent).toContain("Because."));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(asked.map((a) => a.body.messages)).toEqual([
      [{ role: "user", text: "Why?" }],
      [{ role: "user", text: "Why?" }],
    ]);
  });

  test.each([
    [
      "no_api_key",
      409,
      "Add your OpenRouter API key in Settings to ask the Grader.",
      "Open Settings",
    ],
    ["model_unavailable", 502, "OpenRouter can't run Claude Haiku 5.5 right now.", "Open Settings"],
    ["no_credits", 502, "Your OpenRouter account is out of credits.", "Try again"],
    ["grading_refused", 502, "OpenRouter refused to answer this.", undefined],
  ] as const)("%s: its message, with %s", async (code, status, message, action) => {
    chat = () => json({ error: { code, message: "x" } }, status);
    const { field } = await gradedScreen();
    ask(field, "Why?");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(message);
    const buttons = [...alert.querySelectorAll("a, button")].map((b) => b.textContent);
    expect(buttons).toEqual(action === undefined ? [] : [action]);
  });

  test("a network error says Banki can't be reached, with Try again", async () => {
    chat = () => {
      throw new TypeError("Failed to fetch");
    };
    const { field } = await gradedScreen();
    ask(field, "Why?");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Can't reach Banki");
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  test("a stream that breaks keeps its text, marked cut off, with Try again", async () => {
    const reply = streaming();
    chat = () => reply.response;
    const { field } = await gradedScreen();
    ask(field, "Why?");
    await reply.send("Because the");

    await reply.breakOff();

    await screen.findByText(/Cut off/);
    expect(log().textContent).toContain("Because the");
    chat = () => replied("Because the constant.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(log().textContent).toContain("Because the constant."));
    expect(screen.queryByText(/Cut off/)).toBeNull();
  });

  test("404: the Card was deleted elsewhere, so the toast, and the next Card", async () => {
    chat = () => json({ error: { code: "not_found", message: "Card not found" } }, 404);
    const { field } = await gradedScreen();
    ask(field, "Why?");

    await waitFor(() => expect(screen.getByText("c2 front")).toBeTruthy());
    expect(await screen.findByText(/deleted elsewhere/)).toBeTruthy();
    expect(rated).toEqual([]);
  });

  test("from the 20th message, the long-chat advice shows, and questions still go", async () => {
    chat = () => replied("Yes.");
    const { field } = await gradedScreen();
    for (let n = 1; n <= 9; n += 1) {
      ask(field, `Question ${n}?`);
      await waitFor(() => expect(send()).not.toBeNull());
    }
    await waitFor(() => expect(asked).toHaveLength(9));
    expect(screen.queryByText("This chat is getting long.")).toBeNull();

    ask(field, "Question 10?");
    await waitFor(() => expect(asked).toHaveLength(10));
    await screen.findByText("This chat is getting long.");

    ask(field, "Question 11?");
    await waitFor(() => expect(asked).toHaveLength(11));
  });

  test("rating ends the chat: the next Card shows without one", async () => {
    const { field } = await gradedScreen();
    ask(field, "Why?");
    await waitFor(() => expect(log().textContent).toContain("is the step."));

    press(document.body, "2");

    await waitFor(() => expect(screen.getByText("c2 front")).toBeTruthy());
    expect(document.querySelector("[data-chat-input]")).toBeNull();
    expect(screen.queryByRole("log")).toBeNull();
  });

  test("a reload resumes the Card with its chat", async () => {
    const { field } = await gradedScreen();
    ask(field, "Why?");
    await waitFor(() => expect(log().textContent).toContain("is the step."));
    cleanup();
    queue = ["c1", "c2"];

    renderScreen();

    await screen.findByText(/Suggests/);
    expect(log().textContent).toContain("Why?");
    expect(log().textContent).toContain("is the step.");
    expect(asked).toHaveLength(1);
  });
});
