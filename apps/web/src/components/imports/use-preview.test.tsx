// @vitest-environment happy-dom
import type { ImportPreviewResponse } from "@banki/shared";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import type { Card } from "@/lib/cards";
import { usePreview } from "./use-preview";

const card = (number: number, front: string) => ({
  number,
  front,
  back: "b",
  tags: [],
  gradingNotes: null,
  duplicateOf: null,
});

const preview = (cards: ReturnType<typeof card>[]): ImportPreviewResponse => ({
  id: "i",
  deckId: "d",
  fileName: "f.json",
  source: "json",
  total: cards.length,
  invalid: [],
  createdAt: "2026-10-26T12:00:00.000Z",
  status: "unconfirmed",
  cards,
  macros: [],
  images: [],
  stagedImages: [],
  room: 1000,
});

const deckCard = (front: string): Card => ({
  id: `c-${front}`,
  deckId: "d",
  front,
  back: "x",
  tags: [],
  gradingNotes: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  studied: false,
});

const DECK = [deckCard("la cuenta")];

describe("usePreview", () => {
  test("ticks every Card but Duplicates of the Deck or of an earlier ticked Card, which are locked", () => {
    const { result } = renderHook(() =>
      usePreview(preview([card(1, "a"), card(2, "La cuenta"), card(3, "*a*")]), DECK),
    );
    expect(result.current.rows.map((row) => [row.ticked, row.duplicateOf?.front])).toEqual([
      [true, undefined],
      [false, "la cuenta"],
      [false, "a"],
    ]);
    expect(result.current.ticked.map((c) => c.number)).toEqual([1]);
    expect(result.current.changed).toBe(false);
  });

  test("unticking a Card frees a later one repeating it, and tick all ticks every one that can be", () => {
    const { result } = renderHook(() => usePreview(preview([card(1, "a"), card(2, "a")]), DECK));
    act(() => result.current.toggle(1));
    expect(result.current.ticked.map((c) => c.number)).toEqual([2]);
    expect(result.current.changed).toBe(true);
    act(() => result.current.tickAll(true));
    expect(result.current.ticked.map((c) => c.number)).toEqual([1]);
    act(() => result.current.tickAll(false));
    expect(result.current.ticked).toEqual([]);
  });

  test("rewording a Duplicate's Front unlocks it; editing a Card into one locks it", () => {
    const { result } = renderHook(() =>
      usePreview(preview([card(1, "la cuenta"), card(2, "b")]), DECK),
    );
    act(() =>
      result.current.edit(1, {
        front: "la cuenta, por favor",
        back: "b",
        tags: [],
        gradingNotes: null,
      }),
    );
    expect(result.current.rows[0]).toMatchObject({
      ticked: true,
      edited: true,
      duplicateOf: undefined,
    });
    act(() =>
      result.current.edit(2, { front: "LA CUENTA", back: "b", tags: ["x"], gradingNotes: null }),
    );
    expect(result.current.rows[1]).toMatchObject({
      ticked: false,
      duplicateOf: { front: "la cuenta" },
    });
    expect(result.current.ticked.map((c) => [c.number, c.front])).toEqual([
      [1, "la cuenta, por favor"],
    ]);
  });
});
