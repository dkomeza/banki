// @vitest-environment happy-dom
import type { SettingsResponse } from "@banki/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  RouterContextProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { StudyCard } from "@/components/decks/study-card";
import type { Card } from "@/lib/cards";
import type { Deck } from "@/lib/decks";
import { type StoredSession, sessionStore } from "@/lib/session-store";
import { settingsQueryOptions } from "@/lib/settings";
import { StudyScreen } from "./study-screen";

// The study screen's Session as the browser runs it: resumed from
// localStorage, its timeout checked on a timer, on focus and on becoming
// visible, and its time saved as the page hides; and the counts the summary
// and the deck page give for the open Session.

vi.mock("@/components/folders/drag", () => ({ useFinePointer: () => true }));

const NOW = Date.parse("2026-05-01T10:00:00Z");
const MINUTE = 60_000;

const DECK: Deck = {
  id: "d1",
  name: "Spanish",
  description: null,
  folderId: null,
  createdAt: "2026-05-01T09:00:00.000Z",
  cardCount: 40,
  desiredRetention: null,
  macros: [],
  answerMode: null,
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

const card = (id: string, front: string): Card => ({
  id,
  deckId: "d1",
  front,
  back: `${front} back`,
  tags: [],
  gradingNotes: null,
  createdAt: "2026-05-01T09:00:00.000Z",
  updatedAt: "2026-05-01T09:00:00.000Z",
  studied: true,
});

const SHOWN = card("c1", "el desayuno");
const FIRST = card("c2", "la cena");

const preview = { state: "learning", scheduledDays: 0, due: "2026-05-01T10:10:00.000Z" };
const PREVIEWS = { again: preview, hard: preview, good: preview, easy: preview };

/** A Session stored with one standing Rating, showing c1 unrevealed for 4 s. */
const STORED: StoredSession = {
  id: "s1",
  writeId: "w1",
  reviewsShown: 2,
  newShown: 20,
  batches: 1,
  after: "c1",
  seen: [
    ["c0", "review"],
    ["c1", "review"],
  ],
  resetKinds: [],
  gone: [],
  given: [
    {
      reviewId: "r0",
      cardId: "c0",
      kind: "review",
      rating: "good",
      durationMs: 3000,
      settled: false,
    },
  ],
  shown: {
    cardId: "c1",
    kind: "review",
    revealed: false,
    undone: false,
    elapsedMs: 4000,
    draft: "",
    checked: false,
  },
  activeAt: NOW,
};

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });

/** The query of each `study/overview` asked, as `newShown/batches`. */
let overviews: string[] = [];

beforeEach(() => {
  overviews = [];
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(NOW);
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input), "http://banki.test");
    switch (url.pathname) {
      case "/api/cards/c1":
        return json(SHOWN);
      case "/api/cards/c1/intervals":
        return json(PREVIEWS);
      case "/api/decks/d1/study/next":
        return json({
          next: {
            card: FIRST,
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
            intervals: PREVIEWS,
          },
          newHeld: 0,
        });
      case "/api/decks/d1/study/overview":
        overviews.push(`${url.searchParams.get("newShown")}/${url.searchParams.get("batches")}`);
        return json({ due: 3, new: 0, newTotal: 37, estimateMs: 60_000, nextDue: null });
      default:
        return json([]);
    }
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  localStorage.clear();
  setVisibility("visible");
});

const stored = () => sessionStore("d1").read();

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
}

function renderWith(children: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(settingsQueryOptions().queryKey, { settings: SETTINGS, issuedAt: 0 });
  const router = createRouter({ routeTree: createRootRoute(), history: createMemoryHistory() });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterContextProvider router={router}>{children}</RouterContextProvider>
    </QueryClientProvider>,
  );
}

/** Opens Study on the stored Session, resumed at c1. */
async function resumeStudy() {
  sessionStore("d1").write(STORED);
  renderWith(<StudyScreen deck={DECK} />);
  await screen.findByText("el desayuno");
}

/** Moves the clock on by `ms`, firing the timers due meanwhile. */
const pass = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

const ENDED = "Session ended after 30 min without activity.";

describe("an open study screen", () => {
  test("ends the Session on its summary once the timer finds it past its timeout, and Start a new session starts afresh", async () => {
    await resumeStudy();

    await pass(30 * MINUTE - 15_000);
    expect(screen.queryByText(ENDED)).toBeNull();
    await pass(15_000);

    expect(await screen.findByText(ENDED)).toBeDefined();
    expect(screen.queryByText("Keep studying")).toBeNull();
    expect(stored()).toBeUndefined();

    fireEvent.click(screen.getByRole("button", { name: "Start a new session" }));
    expect(await screen.findByText("la cena")).toBeDefined();
  });

  test("checks the timeout on focus", async () => {
    await resumeStudy();
    vi.setSystemTime(NOW + 30 * MINUTE);

    act(() => {
      window.dispatchEvent(new Event("focus"));
    });

    expect(await screen.findByText(ENDED)).toBeDefined();
  });

  test("checks it no more while hidden, and again on becoming visible", async () => {
    await resumeStudy();
    setVisibility("hidden");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await pass(30 * MINUTE);
    expect(screen.queryByText(ENDED)).toBeNull();

    setVisibility("visible");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(await screen.findByText(ENDED)).toBeDefined();
  });

  test("saves the shown Card's time as the page hides or goes, which is no activity", async () => {
    await resumeStudy();
    vi.setSystemTime(NOW + 5000);
    window.dispatchEvent(new Event("pagehide"));
    expect(stored()?.shown?.elapsedMs).toBe(9000);

    vi.setSystemTime(NOW + 7000);
    setVisibility("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(stored()?.shown?.elapsedMs).toBe(11000);
    // Resuming was activity; the time on screen since isn't.
    expect(stored()?.activeAt).toBe(NOW);
  });

  test("left, sums up what the open Session has left to study, as the deck page counts it", async () => {
    await resumeStudy();

    fireEvent.keyDown(document.body, { key: "Escape" });

    expect(await screen.findByText("Keep studying")).toBeDefined();
    expect(overviews).toEqual(["20/1"]);
  });

  test("left, counts the Session's own progress though storage can't be read", async () => {
    await resumeStudy();
    vi.stubGlobal("localStorage", undefined);

    fireEvent.keyDown(document.body, { key: "Escape" });

    expect(await screen.findByText("Keep studying")).toBeDefined();
    expect(overviews).toEqual(["20/1"]);
  });
});

describe("the deck page's Study card", () => {
  test("with an open Session, reads Continue, its counts for the Session's progress", async () => {
    sessionStore("d1").write(STORED);
    renderWith(<StudyCard deckId="d1" />);

    expect(await screen.findByText("Continue")).toBeDefined();
    expect(overviews).toEqual(["20/1"]);
  });

  test("with the stored Session past its timeout, reads Study, its counts a fresh Session's", async () => {
    sessionStore("d1").write({ ...STORED, activeAt: NOW - 30 * MINUTE });
    renderWith(<StudyCard deckId="d1" />);

    expect(await screen.findByText("Study")).toBeDefined();
    expect(overviews).toEqual(["0/1"]);
  });
});
