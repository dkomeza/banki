import type { SettingsResponse } from "@banki/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  RouterContextProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { Deck } from "@/lib/decks";
import { settingsQueryOptions } from "@/lib/settings";
import {
  INTERVALS_FAILED,
  NO_CHAT,
  RATE_FAILED,
  type StudyState,
  createStudySession,
  studyApi,
} from "@/lib/study";
import { Dock, End } from "./study-screen";

const DECK: Deck = {
  id: "d1",
  name: "Spanish",
  description: null,
  folderId: null,
  createdAt: "2026-05-01T09:00:00.000Z",
  cardCount: 30,
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

const DONE: StudyState = {
  phase: "done",
  shown: undefined,
  previewedAt: 0,
  revealed: false,
  saving: undefined,
  undoing: false,
  failure: undefined,
  rated: 0,
  undoable: false,
  ratable: false,
  undone: false,
  newHeld: 0,
  loadingMore: false,
  summary: { studied: 0, newStudied: 0, recall: null, timeMs: 0 },
  editing: false,
  editable: false,
  progressReset: false,
  turning: false,
  skipping: false,
  refreshing: false,
  endedAfterMs: 0,
  mode: "self-rate",
  draft: "",
  written: undefined,
  dontKnow: false,
  switchable: false,
  checkable: false,
  grade: undefined,
  chat: NO_CHAT,
  askable: false,
};

/** The end screen's markup for `state`, with the Settings' New-card batch at `batch` (none loaded when null). */
function renderEnd(state: Partial<StudyState>, batch: number | null = 20) {
  const queryClient = new QueryClient();
  if (batch !== null) {
    queryClient.setQueryData(settingsQueryOptions().queryKey, {
      settings: { ...SETTINGS, newCardBatch: batch },
      issuedAt: 0,
    });
  }
  const router = createRouter({
    routeTree: createRootRoute(),
    history: createMemoryHistory(),
  });
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <RouterContextProvider router={router}>
        <End deck={DECK} state={{ ...DONE, ...state }} onRetry={() => {}} onMore={() => {}} />
      </RouterContextProvider>
    </QueryClientProvider>,
  );
}

/** The markup with its tags dropped, for reading what it says. */
const text = (markup: string) => markup.replaceAll(/<[^>]+>/g, " ").replaceAll(/\s+/g, " ");

describe("End", () => {
  test("with New cards held, says how many wait and offers a batch of the New-card batch's size", () => {
    const out = renderEnd({ newHeld: 37 });

    expect(text(out)).toContain("Done for now");
    expect(text(out)).toContain("37 new cards are waiting.");
    expect(out).toMatch(/<button[^>]*>[^<]*Learn 20 more<\/button>/);
    expect(text(out)).toContain("Back to deck");
  });

  test("with none held, ends as it always did: no waiting count, no Learn more", () => {
    const out = renderEnd({ newHeld: 0 });

    expect(text(out)).toContain("Done for now");
    expect(text(out)).not.toContain("waiting");
    expect(text(out)).not.toContain("Learn");
    expect(text(out)).toContain("Back to deck");
  });

  test("never offers more outside the done phase", () => {
    expect(text(renderEnd({ phase: "nothing", newHeld: 5 }))).not.toContain("Learn");
  });

  test("still offers more, unnumbered, when the Settings aren't loaded", () => {
    expect(text(renderEnd({ newHeld: 3 }, null))).toContain("Learn more");
  });

  test("disables Learn more while the next batch loads", () => {
    const out = renderEnd({ newHeld: 3, loadingMore: true });

    expect(out).toMatch(/<button[^>]* disabled=""[^>]*>.*Learn 20 more<\/button>/);
  });
});

describe("Dock", () => {
  // Never started: the Dock only reads `state` here.
  const IDLE = createStudySession({ studyApi: studyApi("d1"), notify: () => {} });
  const preview = { state: "learning" as const, scheduledDays: 0, due: "2026-05-01T10:10:00.000Z" };
  const RESET: Partial<StudyState> = {
    phase: "card",
    revealed: true,
    progressReset: true,
    shown: {
      kind: "review",
      intervals: { again: preview, hard: preview, good: preview, easy: preview },
      card: {
        id: "a",
        deckId: "d1",
        front: "a front",
        back: "a back",
        tags: [],
        gradingNotes: null,
        createdAt: "2026-05-01T09:00:00.000Z",
        updatedAt: "2026-05-01T09:00:00.000Z",
        studied: false,
      },
    },
  };
  /** The `view-transition-name`s the Dock gives out over `state`. */
  const names = (state: Partial<StudyState>) =>
    renderToStaticMarkup(<Dock session={IDLE} state={{ ...DONE, ...state }} />).match(
      /view-transition-name:[a-z-]+/g,
    ) ?? [];
  const dock = (state: Partial<StudyState>) =>
    text(renderToStaticMarkup(<Dock session={IDLE} state={{ ...DONE, ...state }} />));

  test("after a Progress reset, says the Intervals are a New card's", () => {
    expect(dock(RESET)).toContain("Back to New");
  });

  test("not while Try again loads them, nor once they failed, as the old ones still show", () => {
    expect(dock({ ...RESET, refreshing: true })).not.toContain("Back to New");
    expect(dock({ ...RESET, failure: INTERVALS_FAILED })).not.toContain("Back to New");
  });

  test("still, once a Rating of the reset Card failed: its Intervals are the fresh ones", () => {
    expect(dock({ ...RESET, failure: RATE_FAILED })).toContain("Back to New");
  });

  test("the Intervals and the note turn over on the close after the reset only", () => {
    expect(names({ ...RESET, turning: true })).toEqual(
      expect.arrayContaining([
        "view-transition-name:interval-again",
        "view-transition-name:interval-easy",
        "view-transition-name:reset-note",
      ]),
    );
    expect(names({ ...RESET, turning: false })).not.toEqual(
      expect.arrayContaining(["view-transition-name:interval-again"]),
    );
    expect(names({ ...RESET, turning: false })).not.toEqual(
      expect.arrayContaining(["view-transition-name:reset-note"]),
    );
  });
});
