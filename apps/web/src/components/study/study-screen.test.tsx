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
import type { StudyState } from "@/lib/study";
import { End } from "./study-screen";

const DECK: Deck = {
  id: "d1",
  name: "Spanish",
  description: null,
  folderId: null,
  createdAt: "2026-05-01T09:00:00.000Z",
  cardCount: 30,
  desiredRetention: null,
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
};

const DONE: StudyState = {
  phase: "done",
  shown: undefined,
  previewedAt: 0,
  revealed: false,
  saving: undefined,
  undoing: false,
  failure: undefined,
  rated: 12,
  ratable: false,
  undone: false,
  newHeld: 0,
  loadingMore: false,
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
    expect(text(out)).toContain("12 cards rated.");
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
