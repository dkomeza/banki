// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { SettingsResponse } from "@banki/shared";
import { type Card, cardsQueryOptions } from "@/lib/cards";
import { type Deck, decksQueryOptions } from "@/lib/decks";
import { foldersQueryOptions } from "@/lib/folders";
import { settingsQueryOptions } from "@/lib/settings";
import { EditCard } from "./edit-card";

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

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

type Sent = { method: string; path: string; body: unknown };

/**
 * The API, answering `answer` for each request it is sent, and recording those
 * that write (the form's own reads, such as the Settings, go unrecorded).
 */
function stubApi(answer: (method: string, path: string) => Response | Promise<Response>) {
  const sent: Sent[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    const request = new Request(new URL(url, "http://banki.test"), init);
    const path = new URL(request.url).pathname;
    const text = await request.text();
    if (request.method !== "GET") {
      sent.push({ method: request.method, path, body: text === "" ? undefined : JSON.parse(text) });
    }
    return answer(request.method, path);
  });
  return sent;
}

/** The edit page on `shown`, in a router that has its Deck's page to go back to. */
async function renderPage(shown: Card) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // What the page reads as it opens: the Library, the Settings, the Deck's Cards.
  queryClient.setQueryData(foldersQueryOptions().queryKey, []);
  queryClient.setQueryData(decksQueryOptions().queryKey, [DECK]);
  queryClient.setQueryData(settingsQueryOptions().queryKey, { settings: SETTINGS, issuedAt: 0 });
  queryClient.setQueryData(cardsQueryOptions(DECK.id).queryKey, [shown]);
  const root = createRootRoute();
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({
        getParentRoute: () => root,
        path: "/cards/$cardId",
        component: () => <EditCard deck={DECK} card={shown} />,
      }),
      createRoute({
        getParentRoute: () => root,
        path: "/decks/$deckId",
        component: () => <p>The Deck's page</p>,
      }),
    ]),
    history: createMemoryHistory({ initialEntries: [`/cards/${shown.id}`] }),
  });
  await router.load();
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await screen.findByRole("heading", { name: "Edit card" });
  return router;
}

/** The Reset progress checkbox. */
function resetBox(): HTMLInputElement {
  const box = screen.getByRole("checkbox");
  if (!(box instanceof HTMLInputElement)) throw new Error("Reset progress isn't an input");
  return box;
}
const button = (name: string) => screen.getByText(name, { selector: "button" });
const onDeck = () => screen.findByText("The Deck's page");
const discardAsked = () => screen.queryByText("Discard changes?");

// Nothing reaches a real API: what a test doesn't stub answers 404.
beforeEach(() => {
  stubApi(() => json({ code: "not_found" }, 404));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("The edit page's Reset progress", () => {
  test("shows on a studied Card, unticked", async () => {
    await renderPage(card(true));

    expect(screen.getByText("Reset progress")).toBeTruthy();
    expect(resetBox().checked).toBe(false);
  });

  test("never shows on a New Card", async () => {
    await renderPage(card(false));

    expect(screen.queryByText("Reset progress")).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  test("ticked, Save sends it with the edit and goes back to the Deck", async () => {
    const sent = stubApi((method) =>
      method === "PATCH" ? json({ ...card(true), studied: false }) : json([]),
    );
    const router = await renderPage(card(true));
    fireEvent.click(resetBox());

    fireEvent.click(button("Save"));

    await onDeck();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      method: "PATCH",
      path: "/api/cards/c1",
      body: { front: "el desayuno", back: "breakfast", tags: ["food"], resetProgress: true },
    });
    expect(router.state.location.pathname).toBe("/decks/d1");
    expect(discardAsked()).toBeNull();
  });

  test("unticked, Save sends no reset", async () => {
    const sent = stubApi((method) => (method === "PATCH" ? json(card(true)) : json([])));
    await renderPage(card(true));

    fireEvent.click(button("Save"));

    await onDeck();
    expect(sent[0]?.body).not.toHaveProperty("resetProgress");
  });

  test("can't change while the Save that carries it is on its way", async () => {
    let answer: ((res: Response) => void) | undefined;
    const answered = new Promise<Response>((resolve) => {
      answer = resolve;
    });
    stubApi((method) => (method === "PATCH" ? answered : json([])));
    await renderPage(card(true));
    fireEvent.click(resetBox());

    fireEvent.click(button("Save"));

    await waitFor(() => expect(resetBox().disabled).toBe(true));
    answer?.(json({ ...card(true), studied: false }));
    await onDeck();
  });
});

describe("The edit page's discard guard", () => {
  test("Cancel with nothing unsaved goes back to the Deck unasked", async () => {
    await renderPage(card(true));

    fireEvent.click(button("Cancel"));

    await onDeck();
    expect(discardAsked()).toBeNull();
  });

  test("a ticked Reset progress alone counts as unsaved: Keep editing stays, Discard leaves", async () => {
    const router = await renderPage(card(true));
    fireEvent.click(resetBox());

    fireEvent.click(button("Cancel"));
    await waitFor(() => expect(discardAsked()).not.toBeNull());

    fireEvent.click(button("Keep editing"));
    await waitFor(() => expect(discardAsked()).toBeNull());
    expect(router.state.location.pathname).toBe("/cards/c1");
    expect(resetBox().checked).toBe(true);

    fireEvent.click(button("Cancel"));
    fireEvent.click(await screen.findByText("Discard", { selector: "button" }));
    await onDeck();
  });

  test("Delete deletes at once and goes back to the Deck unasked, even with the box ticked", async () => {
    const sent = stubApi((method) =>
      method === "DELETE" ? json({ deletionId: "del1" }) : json([]),
    );
    await renderPage(card(true));
    fireEvent.click(resetBox());

    fireEvent.click(button("Delete"));

    await onDeck();
    expect(sent).toEqual([{ method: "DELETE", path: "/api/cards/c1", body: undefined }]);
    expect(discardAsked()).toBeNull();
  });
});
