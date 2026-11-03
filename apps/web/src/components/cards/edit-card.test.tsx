// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { EditorView } from "@codemirror/view";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { SettingsResponse } from "@banki/shared";
import { type Card, cardQueryOptions, cardsQueryOptions } from "@/lib/cards";
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

/** The edit page on the Card as cached, as the route reads it, never fetched again unless a test says so. */
function CachedCard({ id }: { id: string }) {
  const { data } = useQuery({ ...cardQueryOptions(id), staleTime: Infinity });
  return data ? <EditCard deck={DECK} card={data} /> : null;
}

/** The edit page on `shown`, in a router that has its Deck's page to go back to. */
async function renderPage(shown: Card) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // What the page reads as it opens: the Library, the Settings, the Deck's Cards.
  queryClient.setQueryData(foldersQueryOptions().queryKey, []);
  queryClient.setQueryData(decksQueryOptions().queryKey, [DECK]);
  queryClient.setQueryData(settingsQueryOptions().queryKey, { settings: SETTINGS, issuedAt: 0 });
  queryClient.setQueryData(cardsQueryOptions(DECK.id).queryKey, [shown]);
  queryClient.setQueryData(cardQueryOptions(shown.id).queryKey, shown);
  const root = createRootRoute();
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({
        getParentRoute: () => root,
        path: "/cards/$cardId",
        component: () => <CachedCard id={shown.id} />,
      }),
      createRoute({
        getParentRoute: () => root,
        path: "/decks/$deckId",
        component: () => <p>The Deck's page</p>,
      }),
      createRoute({
        getParentRoute: () => root,
        path: "/login",
        component: () => <p>The sign-in page</p>,
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
  return { router, queryClient };
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
    const { router } = await renderPage(card(true));
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

  test("can't change, nor can the Tags, Cancel or Delete, while the Save that carries it is on its way", async () => {
    let answer: ((res: Response) => void) | undefined;
    const answered = new Promise<Response>((resolve) => {
      answer = resolve;
    });
    stubApi((method) => (method === "PATCH" ? answered : json([])));
    await renderPage(card(true));
    fireEvent.click(resetBox());

    fireEvent.click(button("Save"));

    await waitFor(() => expect(resetBox().disabled).toBe(true));
    // Nor can the sides, so nothing typed meanwhile is lost when the page goes.
    for (const side of document.querySelectorAll<HTMLElement>(".cm-content"))
      expect(EditorView.findFromDOM(side)?.state.readOnly).toBe(true);
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Backspace" });
    expect(screen.getByText("food")).toBeTruthy();
    expect(button("Cancel").hasAttribute("disabled")).toBe(true);
    expect(button("Delete").hasAttribute("disabled")).toBe(true);
    expect(button("Save").hasAttribute("disabled")).toBe(true);
    answer?.(json({ ...card(true), studied: false }));
    await onDeck();
  });

  test.each([
    [
      "the API fails",
      () => json({ code: "internal" }, 500),
      "Banki couldn't save the card. Try again.",
    ],
    [
      "the answer drops while it comes in",
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new TypeError("network error"));
            },
          }),
        ),
      "Can't reach Banki. Check your connection and try again.",
    ],
    [
      "the answer isn't JSON",
      () => new Response("<html>", { headers: { "content-type": "text/html" } }),
      "Banki couldn't save the card. Try again.",
    ],
    [
      "the answer isn't a Card",
      () => json({ id: "c1" }),
      "Banki couldn't save the card. Try again.",
    ],
  ])(
    "comes back ticked and can change again when %s, with the error shown",
    async (_, failed, error) => {
      stubApi((method) => (method === "PATCH" ? failed() : json([])));
      await renderPage(card(true));
      fireEvent.click(resetBox());

      fireEvent.click(button("Save"));

      await screen.findByText(error);
      expect(resetBox().checked).toBe(true);
      expect(resetBox().disabled).toBe(false);
      fireEvent.click(resetBox());
      expect(resetBox().checked).toBe(false);
      expect(screen.queryByText("The Deck's page")).toBeNull();
    },
  );

  test("stays as it was while the Save finishes, though its answer is a Card back to New", async () => {
    // The Deck's Cards, fetched again once the Card is saved, answer when the test says.
    let refreshed: ((res: Response) => void) | undefined;
    const refetch = new Promise<Response>((resolve) => {
      refreshed = resolve;
    });
    const sent = stubApi((method, path) =>
      method === "PATCH"
        ? json({ ...card(true), studied: false })
        : path === "/api/decks/d1/cards"
          ? refetch
          : json([]),
    );
    const { queryClient } = await renderPage(card(true));
    fireEvent.click(resetBox());

    fireEvent.click(button("Save"));

    await waitFor(() => expect(sent).toHaveLength(1));
    await waitFor(() =>
      expect(queryClient.getQueryData(cardQueryOptions("c1").queryKey)).toMatchObject({
        studied: false,
      }),
    );
    expect(resetBox().checked).toBe(true);
    expect(resetBox().disabled).toBe(true);
    refreshed?.(json([]));
    await onDeck();
  });

  test("goes, tick and all, when a refetch finds the Card New, and comes back unticked", async () => {
    const { queryClient } = await renderPage(card(true));
    fireEvent.click(resetBox());

    await act(async () => {
      queryClient.setQueryData(cardQueryOptions("c1").queryKey, card(false));
    });
    await waitFor(() => expect(screen.queryByRole("checkbox")).toBeNull());

    await act(async () => {
      queryClient.setQueryData(cardQueryOptions("c1").queryKey, card(true));
    });
    await waitFor(() => expect(screen.queryByRole("checkbox")).not.toBeNull());
    expect(resetBox().checked).toBe(false);
  });
});

describe("The edit page's discard guard", () => {
  test("Cancel with nothing unsaved goes back to the Deck unasked", async () => {
    await renderPage(card(true));

    fireEvent.click(button("Cancel"));

    await onDeck();
    expect(discardAsked()).toBeNull();
  });

  test("holds the page while a Save is on its way: a link or Back leaves nothing, unasked", async () => {
    let answer: ((res: Response) => void) | undefined;
    stubApi((method) =>
      method === "PATCH"
        ? new Promise<Response>((resolve) => {
            answer = resolve;
          })
        : json([]),
    );
    const { router } = await renderPage(card(true));
    fireEvent.click(resetBox());
    fireEvent.click(button("Save"));
    await waitFor(() => expect(answer).toBeDefined());

    await act(async () => {
      void router.navigate({ to: "/decks/$deckId", params: { deckId: "d1" } });
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(router.state.location.pathname).toBe("/cards/c1");
    await act(async () => {
      router.history.back();
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(router.state.location.pathname).toBe("/cards/c1");
    expect(discardAsked()).toBeNull();

    answer?.(json({ ...card(true), studied: false }));
    await onDeck();
  });

  test("lets the sign-in redirect through while a Save is on its way, as a 401 sends it", async () => {
    stubApi((method) => (method === "PATCH" ? new Promise<Response>(() => {}) : json([])));
    const { router } = await renderPage(card(true));
    fireEvent.click(resetBox());
    fireEvent.click(button("Save"));
    await waitFor(() => expect(button("Cancel").hasAttribute("disabled")).toBe(true));

    // As goToSignIn does, while the PATCH that answered 401 is still on its way.
    await act(async () => {
      void router.navigate({ href: "/login?redirect=%2Fcards%2Fc1" });
    });

    await screen.findByText("The sign-in page");
    expect(discardAsked()).toBeNull();
  });

  test("a ticked Reset progress alone counts as unsaved: Keep editing stays, Discard leaves", async () => {
    const { router } = await renderPage(card(true));
    fireEvent.click(resetBox());

    fireEvent.click(button("Cancel"));
    await waitFor(() => expect(discardAsked()).not.toBeNull());
    // Nothing was written: it says changes, not writing.
    expect(screen.getByText("Your changes to this card haven't been saved.")).not.toBeNull();

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

  test("holds the page while a Delete is on its way: Save sends nothing, and a failed Delete leaves it as it was", async () => {
    let answer: ((res: Response) => void) | undefined;
    const sent = stubApi((method) =>
      method === "DELETE"
        ? new Promise<Response>((resolve) => {
            answer = resolve;
          })
        : json([]),
    );
    const { router } = await renderPage(card(true));
    fireEvent.click(resetBox());
    fireEvent.click(button("Delete"));
    await waitFor(() => expect(answer).toBeDefined());

    expect(button("Delete").hasAttribute("disabled")).toBe(true);
    expect(button("Cancel").hasAttribute("disabled")).toBe(true);
    expect(button("Save").hasAttribute("disabled")).toBe(true);
    expect(resetBox().disabled).toBe(true);
    fireEvent.click(button("Save"));
    fireEvent.keyDown(document.querySelector(".cm-content")!, { key: "Enter", ctrlKey: true });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(sent).toEqual([{ method: "DELETE", path: "/api/cards/c1", body: undefined }]);

    answer?.(json({ code: "internal" }, 500));
    await waitFor(() => expect(button("Delete").hasAttribute("disabled")).toBe(false));
    expect(router.state.location.pathname).toBe("/cards/c1");
    expect(resetBox().checked).toBe(true);
    expect(resetBox().disabled).toBe(false);
  });
});
