import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  RouterContextProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { type Card, cardsQueryOptions } from "@/lib/cards";
import type { Deck } from "@/lib/decks";
import { createStudySession } from "@/lib/study";
import { StudyEditor } from "./study-editor";

vi.mock("@/components/folders/drag", () => ({ useFinePointer: () => false }));

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

const card = (studied: boolean): Card => ({
  id: "c1",
  deckId: "d1",
  front: "el desayuno",
  back: "breakfast",
  tags: ["food"],
  gradingNotes: null,
  createdAt: "2026-05-01T09:00:00.000Z",
  updatedAt: "2026-05-01T09:00:00.000Z",
  studied,
});

/** The open editor's markup over `shown`. */
function renderEditor(shown: Card) {
  const queryClient = new QueryClient();
  queryClient.setQueryData(cardsQueryOptions(DECK.id).queryKey, [shown]);
  const router = createRouter({ routeTree: createRootRoute(), history: createMemoryHistory() });
  const session = createStudySession({
    studyApi: {
      next: async () => ({ next: null, newHeld: 0 }),
      rate: async () => "gone",
      undo: async () => "gone",
      intervals: async () => "gone",
    },
    notify: () => {},
  });
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <RouterContextProvider router={router}>
        <StudyEditor deck={DECK} card={shown} revealed session={session} />
      </RouterContextProvider>
    </QueryClientProvider>,
  );
}

describe("StudyEditor", () => {
  test("offers Reset progress on a studied Card, unticked", () => {
    const out = renderEditor(card(true));

    expect(out).toContain("Reset progress");
    expect(out).toContain("Keeps its reviews, starts its schedule over.");
    expect(out).toMatch(/<input type="checkbox"(?![^>]*checked)[^>]*>/);
  });

  test("never offers it on a New Card", () => {
    const out = renderEditor(card(false));

    expect(out).not.toContain("Reset progress");
    expect(out).not.toContain('type="checkbox"');
  });

  test("is the edit page's form, with Delete, Cancel and Save along its foot", () => {
    const out = renderEditor(card(true));

    expect(out).toContain('role="dialog"');
    expect(out).toContain('aria-label="Front formatting"');
    expect(out).toContain('aria-label="Back formatting"');
    expect(out).toContain("Add grading notes");
    expect(out).toContain("food");
    for (const action of ["Delete", "Cancel", "Save"]) expect(out).toContain(`>${action}</button>`);
  });
});
