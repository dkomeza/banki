// @vitest-environment happy-dom
import type { DeckTuningStatus } from "@banki/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { Deck } from "@/lib/decks";
import { deckTuningQueryOptions } from "@/lib/tuning";
import { DeckSchedulingCard } from "./deck-scheduling-card";

const DECK: Deck = {
  id: "d1",
  name: "Spanish vocabulary",
  description: null,
  folderId: null,
  createdAt: "2026-05-01T09:00:00.000Z",
  cardCount: 2,
  desiredRetention: null,
  macros: [],
  answerMode: null,
  plan: null,
};

const FOLLOWING: DeckTuningStatus = {
  parameters: "overall",
  tuned: null,
  reviewCount: 412,
  threshold: 1000,
  lastAttempt: null,
  recommendedRetention: null,
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The card for `DECK`, with `status` as its Tuning status, or none loaded when undefined. */
async function renderCard(status: DeckTuningStatus | undefined) {
  // Nothing reaches a real API.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({}, { status: 500 })),
  );
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (status !== undefined) {
    queryClient.setQueryData(deckTuningQueryOptions(DECK.id).queryKey, status);
  }
  const root = createRootRoute();
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({
        getParentRoute: () => root,
        path: "/",
        component: () => <DeckSchedulingCard deck={DECK} />,
      }),
      createRoute({ getParentRoute: () => root, path: "/settings" }),
    ]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await screen.findByRole("heading", { name: "Scheduling" });
}

describe("DeckSchedulingCard", () => {
  test("says how the Deck is scheduled, and where the controls are", async () => {
    await renderCard(FOLLOWING);

    expect(
      screen.getByText(
        "Follows your overall scheduling until this deck has 1,000 reviews (412 so far).",
      ),
    ).toBeTruthy();
    const link = screen.getByRole("link", {
      name: "Tune now and Reset are in Settings → Advanced",
    });
    expect(link.getAttribute("href")).toBe("/settings#advanced");
  });

  test("a fit of its own", async () => {
    await renderCard({
      ...FOLLOWING,
      parameters: "own",
      tuned: { at: "2026-05-20T09:00:00.000Z", reviews: 1204 },
    });

    expect(screen.getByText(/^Fitted to how you remember this deck on 20 May/)).toBeTruthy();
  });

  test("says so when the status can't load, and the card still shows", async () => {
    await renderCard(undefined);

    expect(await screen.findByText("Couldn't load how this deck is scheduled.")).toBeTruthy();
  });
});
