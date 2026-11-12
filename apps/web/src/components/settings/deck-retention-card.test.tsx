// @vitest-environment happy-dom
import type { DeckTuningStatus, SettingsResponse } from "@banki/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { deckRetentionSaverFor } from "@/lib/deck-retention";
import type { Deck } from "@/lib/decks";
import { settingsQueryOptions } from "@/lib/settings";
import { deckTuningQueryOptions } from "@/lib/tuning";
import { DeckRetentionCard } from "./deck-retention-card";

const DECK: Deck = {
  id: "d1",
  name: "Calculus 2",
  description: null,
  folderId: null,
  createdAt: "2026-05-01T09:00:00.000Z",
  cardCount: 2,
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

/**
 * How Tuning stands for the Deck: following the overall Parameters, or with
 * its own, and `recommendedRetention` as its Recommended retention.
 */
const tuning = (
  recommendedRetention: number | null,
  parameters: DeckTuningStatus["parameters"] = "overall",
): DeckTuningStatus => ({
  parameters,
  tuned: parameters === "own" ? { at: "2026-05-01T09:00:00.000Z", reviews: 1200 } : null,
  reviewCount: 1200,
  threshold: 1000,
  lastAttempt: null,
  recommendedRetention,
});

afterEach(cleanup);

/**
 * The section for `deck`, saving through `save`, with `recommended` as the
 * Recommended retention, from a fit of its own when `parameters` is `own`.
 */
function renderCard(
  deck: Deck,
  recommended: number | null | "unavailable",
  save: (retention: number | null) => Promise<void> = async () => {},
  parameters: DeckTuningStatus["parameters"] = "overall",
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(settingsQueryOptions().queryKey, { settings: SETTINGS, issuedAt: 0 });
  if (recommended !== "unavailable") {
    queryClient.setQueryData(
      deckTuningQueryOptions(deck.id).queryKey,
      tuning(recommended, parameters),
    );
  }
  deckRetentionSaverFor(queryClient, deck.id, { save });
  render(
    <QueryClientProvider client={queryClient}>
      <DeckRetentionCard deck={deck} />
    </QueryClientProvider>,
  );
  return queryClient;
}

const picker = () => screen.getByRole<HTMLInputElement>("combobox");
const useButton = (percent: number) => screen.queryByRole("button", { name: `Use ${percent}%` });

describe("DeckRetentionCard's Recommended retention", () => {
  test("shows nothing while there is none", () => {
    renderCard(DECK, null);

    expect(screen.queryByText(/Recommended/)).toBeNull();
    expect(screen.queryByRole("button", { name: /^Use/ })).toBeNull();
    fireEvent.focus(picker());
    expect(screen.queryByRole("option", { name: /Recommended/ })).toBeNull();
  });

  test("never waits for, or fails on, the tuning status: without it there is no line", async () => {
    // Nothing loaded, and the request fails: there is no API here.
    const queryClient = renderCard(DECK, "unavailable");

    expect(picker().value).toBe("Follow Settings (90%)");
    await waitFor(() =>
      expect(queryClient.getQueryState(deckTuningQueryOptions(DECK.id).queryKey)?.status).toBe(
        "error",
      ),
    );
    expect(picker().value).toBe("Follow Settings (90%)");
    expect(screen.queryByText(/Recommended for you/)).toBeNull();
  });

  test("shows the same line as Settings, and tags its percent in the picker", () => {
    renderCard(DECK, 84);

    expect(screen.getByText("Recommended for you: 84%").parentElement?.textContent).toBe(
      "Recommended for you: 84% · From how well you remember and how long your cards take you, this is where you keep the most for the time you study.",
    );
    fireEvent.focus(picker());
    expect(screen.getByRole("option", { name: "84% Recommended" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Follow Settings 90%" })).toBeTruthy();
  });

  test("Use gives a following Deck its own, saved as a pick is", async () => {
    const sent: (number | null)[] = [];
    renderCard(DECK, 84, async (retention) => {
      sent.push(retention);
    });
    expect(picker().value).toBe("Follow Settings (90%)");

    fireEvent.click(screen.getByRole("button", { name: "Use 84%" }));

    expect(sent).toEqual([84]);
    expect(picker().value).toBe("84%");
    expect(useButton(84)).toBeNull();
    await waitFor(() => expect(screen.getByText("Saved")).toBeTruthy());
  });

  test("Use shows only while the Deck's effective value differs", () => {
    // Its own 84%, or following Settings at 90%: the same value either way.
    renderCard({ ...DECK, desiredRetention: 84 }, 84);
    expect(screen.queryByRole("button", { name: /^Use/ })).toBeNull();
    cleanup();

    renderCard(DECK, 90);
    expect(screen.getByText("Recommended for you: 90%")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Use/ })).toBeNull();
    cleanup();

    renderCard({ ...DECK, desiredRetention: 95 }, 90);
    expect(useButton(90)).toBeTruthy();
  });

  test("shows the Deck's own, with Use, while it has a fit of its own", async () => {
    const sent: (number | null)[] = [];
    renderCard(
      DECK,
      78,
      async (retention) => {
        sent.push(retention);
      },
      "own",
    );

    expect(screen.getByText("Recommended for this deck: 78%").parentElement?.textContent).toBe(
      "Recommended for this deck: 78% · From how well you remember this deck's cards and how long they take you, this is where you keep the most for the time you study.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Use 78%" }));
    expect(sent).toEqual([78]);
  });

  test("follows the tuning status as it is fetched again, after Tune now or Reset", async () => {
    const queryClient = renderCard(DECK, 84);

    await act(async () => {
      queryClient.setQueryData(deckTuningQueryOptions(DECK.id).queryKey, tuning(null));
    });
    await waitFor(() => expect(screen.queryByText(/Recommended for you/)).toBeNull());
  });
});
