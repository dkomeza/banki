// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { Card } from "@/lib/cards";
import type { Deck } from "@/lib/decks";
import { DeckPicker } from "./deck-picker";

const deck = (id: string, name: string, cardCount: number): Deck => ({
  id,
  name,
  description: null,
  folderId: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  cardCount,
  desiredRetention: null,
  macros: [],
  answerMode: null,
  plan: null,
});

const card = (id: string): Card => ({
  id,
  deckId: "from",
  front: id,
  back: "b",
  tags: [],
  gradingNotes: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  studied: false,
});

const FROM = deck("from", "Spanish", 10);
const DECKS = [
  FROM,
  deck("full", "Full deck", 1000),
  deck("over", "Over deck", 1004),
  deck("tight", "Tight deck", 998),
  deck("roomy", "Roomy deck", 997),
];

afterEach(cleanup);

const open = (cards: readonly Card[], onMove = vi.fn()) => {
  render(
    <DeckPicker
      library={{ folders: [], decks: DECKS }}
      from={FROM}
      cards={cards}
      busy={false}
      error={undefined}
      onMove={onMove}
      onClose={() => {}}
    />,
  );
  return onMove;
};

/** The picker for two Cards, over `decks`, showing a refused Move's message. */
const picker = (decks: readonly Deck[]) => (
  <DeckPicker
    library={{ folders: [], decks }}
    from={FROM}
    cards={[card("a"), card("b")]}
    busy={false}
    error="Tight deck has room for 1 more card, so nothing moved."
    onMove={() => {}}
    onClose={() => {}}
  />
);

const option = (name: string) => screen.getByRole("option", { name: new RegExp(name) });

describe("DeckPicker", () => {
  test("lists a Deck without room for the picked Cards, noted Full or Room for n, and it can't be picked", () => {
    const onMove = open([card("a"), card("b"), card("c")]);

    expect(option("Full deck").textContent).toContain("Full");
    expect(option("Full deck")).toHaveProperty("disabled", true);
    expect(option("Over deck").textContent).toContain("Full");
    expect(option("Over deck")).toHaveProperty("disabled", true);
    expect(option("Tight deck").textContent).toContain("Room for 2");
    expect(option("Tight deck")).toHaveProperty("disabled", true);
    expect(option("Roomy deck")).toHaveProperty("disabled", false);
    expect(option("Roomy deck").textContent).not.toContain("Room for");

    fireEvent.click(option("Tight deck"));
    expect(screen.getByRole("button", { name: /^Move$/ })).toHaveProperty("disabled", true);
    fireEvent.click(option("Roomy deck"));
    fireEvent.click(screen.getByRole("button", { name: /Move to Roomy deck/ }));
    expect(onMove).toHaveBeenCalledWith(DECKS[4]);
  });

  test("a Deck with room for exactly the picked Cards can be picked", () => {
    open([card("a"), card("b")]);
    expect(option("Tight deck")).toHaveProperty("disabled", false);
    expect(option("Tight deck").textContent).not.toContain("Room for");
  });

  test("a picked Deck that fills up meanwhile is picked no more", () => {
    const { rerender } = render(picker(DECKS));
    fireEvent.click(option("Tight deck"));
    expect(screen.getByRole("button", { name: /Move to Tight deck/ })).toHaveProperty(
      "disabled",
      false,
    );

    rerender(picker(DECKS.map((d) => (d.id === "tight" ? { ...d, cardCount: 999 } : d))));
    expect(option("Tight deck").textContent).toContain("Room for 1");
    expect(screen.getByRole("button", { name: /^Move$/ })).toHaveProperty("disabled", true);
    expect(screen.getByText(/nothing moved/)).toBeTruthy();
  });
});
