import type { CardHistoryEntry } from "@banki/shared";
import { describe, expect, test } from "vitest";
import { changedSuggestion, durationLabel, historyByDay } from "./card-history";

// Local times, so the days don't depend on the machine's zone.
const local = (d: number, h = 12, min = 0) => new Date(2026, 9, d, h, min).toISOString();
const now = new Date(2026, 9, 26, 13, 0);

const review = (
  id: string,
  at: string,
  extra: Partial<Extract<CardHistoryEntry, { type: "review" }>> = {},
): CardHistoryEntry => ({
  type: "review",
  id,
  cardId: "c",
  deckId: "d",
  reviewedAt: at,
  rating: "good",
  kind: "self-rated",
  suggestedRating: null,
  model: null,
  durationMs: 1000,
  ...extra,
});
const reset = (id: string, at: string): CardHistoryEntry => ({
  type: "progress-reset",
  id,
  resetAt: at,
});

describe("historyByDay", () => {
  test("puts entries, newest first, in runs of one day each, marking those before a Progress reset", () => {
    const entries = [
      review("r3", local(26, 11)),
      review("r2", local(23, 12, 12)),
      reset("p", local(23, 9)),
      review("r1", local(20, 7)),
    ];

    expect(
      historyByDay(entries, now).map(({ day, items }) => [
        day,
        items.map((i) => [i.entry.id, i.beforeReset]),
      ]),
    ).toEqual([
      ["Today", [["r3", false]]],
      [
        "Fri 23 Oct",
        [
          ["r2", false],
          ["p", false],
        ],
      ],
      ["Tue 20 Oct", [["r1", true]]],
    ]);
  });

  test("keeps the Write order when a clock stepped back, so a day can come twice", () => {
    const entries = [review("r2", local(20)), reset("p", local(23)), review("r1", local(20, 9))];

    expect(historyByDay(entries, now).map(({ day }) => day)).toEqual([
      "Tue 20 Oct",
      "Fri 23 Oct",
      "Tue 20 Oct",
    ]);
  });

  test("is no runs for no entries", () => {
    expect(historyByDay([], now)).toEqual([]);
  });
});

describe("durationLabel", () => {
  test.each([
    [0, "0 s"],
    [4_100, "4 s"],
    [41_600, "42 s"],
    [119_400, "119 s"],
    [120_000, "2 min"],
  ])("%d ms reads %s", (ms, label) => {
    expect(durationLabel(ms)).toBe(label);
  });
});

describe("changedSuggestion", () => {
  test("is the suggestion of a graded Review whose Rating differs from it", () => {
    expect(
      changedSuggestion(
        review("r", local(1), { kind: "graded", rating: "again", suggestedRating: "hard" }),
      ),
    ).toBe("hard");
  });

  test("is undefined for a graded Review that kept it, a self-rated one, and a Progress reset", () => {
    expect(
      changedSuggestion(
        review("r", local(1), { kind: "graded", rating: "good", suggestedRating: "good" }),
      ),
    ).toBeUndefined();
    expect(changedSuggestion(review("r", local(1)))).toBeUndefined();
    expect(changedSuggestion(reset("p", local(1)))).toBeUndefined();
  });
});
