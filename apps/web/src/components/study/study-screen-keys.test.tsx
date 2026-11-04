// @vitest-environment happy-dom
import type { SettingsResponse } from "@banki/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  RouterContextProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Card } from "@/lib/cards";
import type { Deck } from "@/lib/decks";
import { settingsQueryOptions } from "@/lib/settings";
import { StudyScreen } from "./study-screen";

vi.mock("@/components/folders/drag", () => ({ useFinePointer: () => true }));

const DECK: Deck = {
  id: "d1",
  name: "Spanish",
  description: null,
  folderId: null,
  createdAt: "2026-05-01T09:00:00.000Z",
  cardCount: 1,
  desiredRetention: null,
  macros: [],
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
  macros: [],
};

const CARD: Card = {
  id: "c1",
  deckId: "d1",
  front: "el desayuno",
  back: "breakfast",
  tags: [],
  gradingNotes: null,
  createdAt: "2026-05-01T09:00:00.000Z",
  updatedAt: "2026-05-01T09:00:00.000Z",
  studied: false,
};

const preview = { state: "learning", scheduledDays: 0, due: "2026-05-01T09:10:00.000Z" };

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });

beforeEach(() => {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const path = new URL(input instanceof Request ? input.url : String(input), "http://banki.test")
      .pathname;
    if (path === "/api/decks/d1/study/next") {
      return json({
        next: {
          card: CARD,
          schedule: {
            state: "new",
            due: null,
            stability: 0,
            difficulty: 0,
            reps: 0,
            lapses: 0,
            scheduledDays: 0,
            lastReview: null,
          },
          kind: "new",
          intervals: { again: preview, hard: preview, good: preview, easy: preview },
        },
        newHeld: 0,
      });
    }
    if (path === "/api/decks/d1/cards") return json([CARD]);
    // A Rating stays on its way.
    if (path === "/api/cards/c1/reviews") return new Promise<Response>(() => {});
    return json([]);
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderScreen() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(settingsQueryOptions().queryKey, { settings: SETTINGS, issuedAt: 0 });
  const router = createRouter({ routeTree: createRootRoute(), history: createMemoryHistory() });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterContextProvider router={router}>
        <StudyScreen deck={DECK} />
      </RouterContextProvider>
    </QueryClientProvider>,
  );
  return router;
}

/** The top bar's Edit. */
const edit = () => screen.getByRole<HTMLButtonElement>("button", { name: "Edit card" });

describe("the study screen's E", () => {
  test("held, opens the editor once, and its repeats type nothing into Front", async () => {
    renderScreen();
    await screen.findByText("el desayuno");

    fireEvent.keyDown(document.body, { key: "e" });
    await waitFor(() =>
      expect(document.querySelector("[data-study-editor] .cm-content")).not.toBeNull(),
    );
    const front = document.querySelector("[data-study-editor] .cm-content")!;

    // fireEvent answers false when the event's default was prevented.
    expect(fireEvent.keyDown(front, { key: "e", repeat: true })).toBe(false);
    expect(fireEvent.keyDown(front, { key: "e", repeat: true })).toBe(false);

    // Let go, a held E in the field types as any key does.
    fireEvent.keyUp(front, { key: "e" });
    expect(fireEvent.keyDown(front, { key: "e" })).toBe(true);
    expect(fireEvent.keyDown(front, { key: "e", repeat: true })).toBe(true);
  });

  test("held while the window loses focus, its repeats type into Front once back", async () => {
    renderScreen();
    await screen.findByText("el desayuno");

    fireEvent.keyDown(document.body, { key: "e" });
    await waitFor(() =>
      expect(document.querySelector("[data-study-editor] .cm-content")).not.toBeNull(),
    );
    const front = document.querySelector("[data-study-editor] .cm-content")!;
    // Its keyup goes to the other window.
    fireEvent.blur(window);

    expect(fireEvent.keyDown(front, { key: "e", repeat: true })).toBe(true);
  });
});

describe("the study screen's Edit", () => {
  test("opens the editor for the shown Card, before the reveal", async () => {
    renderScreen();
    await screen.findByText("el desayuno");
    expect(edit().disabled).toBe(false);

    fireEvent.click(edit());

    await waitFor(() =>
      expect(document.querySelector("[data-study-editor] .cm-content")).not.toBeNull(),
    );
  });

  test("is disabled while a Rating saves, and opens nothing", async () => {
    renderScreen();
    await screen.findByText("el desayuno");
    fireEvent.keyDown(document.body, { key: " " });
    fireEvent.keyDown(document.body, { key: "3" });
    await waitFor(() => expect(edit().disabled).toBe(true));

    fireEvent.click(edit());
    fireEvent.keyDown(document.body, { key: "e" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(document.querySelector("[data-study-editor]")).toBeNull();
  });
});

describe("the study screen's ×", () => {
  test("while editing, reaches the open editor: it closes, and the Session stays", async () => {
    const router = renderScreen();
    const before = router.history.location.pathname;
    await screen.findByText("el desayuno");
    fireEvent.keyDown(document.body, { key: "e" });
    await waitFor(() =>
      expect(document.querySelector("[data-study-editor] .cm-content")).not.toBeNull(),
    );

    // fireEvent answers false when the default was prevented: the link isn't followed.
    expect(fireEvent.click(screen.getByLabelText("Back to deck"))).toBe(false);

    await waitFor(() => expect(document.querySelector("[data-study-editor]")).toBeNull());
    expect(router.history.location.pathname).toBe(before);
    expect(screen.getByText("el desayuno")).toBeTruthy();
    expect(screen.queryByText("Discard changes?")).toBeNull();
  });

  test("a click leaves no focus on it, so Space then reveals", async () => {
    renderScreen();
    await screen.findByText("el desayuno");
    fireEvent.keyDown(document.body, { key: "e" });
    await waitFor(() =>
      expect(document.querySelector("[data-study-editor] .cm-content")).not.toBeNull(),
    );

    const leave = screen.getByLabelText("Back to deck");
    // fireEvent answers false when the default was prevented: no focus moves.
    expect(fireEvent.mouseDown(leave)).toBe(false);
    fireEvent.click(leave);
    await waitFor(() => expect(document.querySelector("[data-study-editor]")).toBeNull());

    fireEvent.keyDown(document.body, { key: " " });
    expect(await screen.findByText("breakfast")).toBeTruthy();
  });
});
