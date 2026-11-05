// @vitest-environment happy-dom
import type { AnswerMode } from "@banki/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { deckAnswerModeSaverFor } from "@/lib/deck-answer-mode";
import type { Deck } from "@/lib/decks";
import { AnswerModeCard } from "./answer-mode-card";

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
};

afterEach(cleanup);

/** The card for `deck`, its saver saving through `save`. */
function renderCard(deck: Deck, save: (mode: AnswerMode | null) => Promise<void>) {
  const queryClient = new QueryClient();
  deckAnswerModeSaverFor(queryClient, deck.id, { save });
  render(
    <QueryClientProvider client={queryClient}>
      <AnswerModeCard deck={deck} />
    </QueryClientProvider>,
  );
}

const picker = () => screen.getByRole<HTMLInputElement>("combobox");

/** Opens the picker and picks the option named `name`. */
function pick(name: string) {
  fireEvent.focus(picker());
  fireEvent.click(screen.getByRole("option", { name: new RegExp(`^${name}`) }));
}

describe("AnswerModeCard", () => {
  test("replaces Coming later: a following Deck shows Follow Settings, with Settings' mode", () => {
    renderCard(DECK, async () => {});

    expect(screen.getByRole("heading", { name: "Answer mode" })).toBeTruthy();
    expect(screen.queryByText("Coming later")).toBeNull();
    expect(picker().value).toBe("Follow Settings (Rate yourself)");
    expect(screen.getByText(/Follows Settings: Rate yourself/)).toBeTruthy();
  });

  test("a Deck with its own shows it", () => {
    renderCard({ ...DECK, answerMode: "write" }, async () => {});

    expect(picker().value).toBe("Write and grade");
    expect(screen.getByText(/Its own, whatever Settings say/)).toBeTruthy();
  });

  test("picks a mode, or Follow Settings, saving each with its save state", async () => {
    const saves: (AnswerMode | null)[] = [];
    const pending: (() => void)[] = [];
    const finish = () => pending.shift()?.();
    // The cache isn't kept here, so the Deck shows its own self-rate again after each save.
    renderCard({ ...DECK, answerMode: "self-rate" }, (mode) => {
      saves.push(mode);
      return new Promise<void>((resolve) => {
        pending.push(resolve);
      });
    });

    pick("Write and grade");
    expect(saves).toEqual(["write"]);
    expect(picker().value).toBe("Write and grade");
    expect(screen.getByText("Saving")).toBeTruthy();
    await act(async () => finish());
    await waitFor(() => expect(screen.getByText("Saved")).toBeTruthy());

    pick("Follow Settings");
    await act(async () => finish());
    expect(saves).toEqual(["write", null]);
  });

  test("a change that didn't save says so, and Try again sends it again", async () => {
    let fail = true;
    const saves: (AnswerMode | null)[] = [];
    renderCard(DECK, async (mode) => {
      saves.push(mode);
      if (fail) throw new Error("offline");
    });

    pick("Write and grade");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(
      "The change to Write and grade didn't save, so it still follows Settings (Rate yourself).",
    );
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(saves).toEqual(["write", "write"]);
  });
});
