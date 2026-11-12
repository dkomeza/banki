import { describe, expect, test } from "bun:test";
import { addStudyDays } from "@banki/shared";
import { DEFAULT_PARAMETERS, NEW_MEMORY_STATE } from "./fsrs";
import {
  type PlanCheckCard,
  type PlanCheckInput,
  type PlanCheckReview,
  checkPlan,
} from "./plan-check";

const studyDay = { timezone: "UTC", dayStartHour: 4 };
// Noon on Study day 2026-05-31.
const now = new Date("2026-05-31T12:00:00Z");
const TODAY = "2026-05-31";
const DAY_MS = 24 * 60 * 60_000;
const DECK = "deck";

/** `count` New cards, written in order. */
const newCards = (count: number, prefix = "n"): PlanCheckCard[] =>
  Array.from({ length: count }, (_, i) => ({
    ...NEW_MEMORY_STATE,
    id: `${prefix}${String(i).padStart(4, "0")}`,
    createdAt: new Date(Date.UTC(2026, 0, 1) + i),
  }));

/**
 * `count` review Cards due at `dueAt`, so stable that a Good Rating puts them
 * past any Deadline here.
 */
const reviewCards = (count: number, dueAt = new Date("2026-05-31T04:00:00Z")): PlanCheckCard[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `r${String(i).padStart(4, "0")}`,
    createdAt: new Date(Date.UTC(2025, 0, 1)),
    state: "review",
    dueAt,
    stability: 400,
    difficulty: 5,
    reps: 10,
    lapses: 0,
    scheduledDays: 300,
    learningStep: 0,
    lastReviewAt: new Date(dueAt.getTime() - 300 * DAY_MS),
  }));

/** A Review of `cardId` in `deckId` at `reviewedAt`. */
const timed = (
  cardId: string,
  reviewedAt: Date,
  durationMs: number,
  { deckId = DECK, wasNew = false } = {},
): PlanCheckReview => ({ cardId, deckId, reviewedAt, durationMs, wasNew });

const input = (overrides: Partial<PlanCheckInput>): PlanCheckInput => ({
  deckId: DECK,
  cards: [],
  reviews: [],
  deadline: addStudyDays(TODAY, 1),
  now,
  desiredRetention: 90,
  studyDay,
  parameters: DEFAULT_PARAMETERS,
  ...overrides,
});

// With no Reviews to average, a review Card takes 10 s and a New card 60 s.

describe("checkPlan", () => {
  test("with a Deadline of tomorrow, simulates today only", () => {
    const result = checkPlan(input({ cards: newCards(10), deadline: addStudyDays(TODAY, 1) }), 5);

    // 5 minutes: 5 New cards today, and no other day.
    expect(result).toMatchObject({ newCards: 10, unlearned: 5 });
  });

  test("pays the due reviews before the New cards", () => {
    const cards = [...reviewCards(6), ...newCards(10)];

    const result = checkPlan(input({ cards }), 5);

    // 6 reviews take 60 s of 300 s, which leaves 4 New cards.
    expect(result).toMatchObject({ newCards: 10, unlearned: 6 });
  });

  test("pays the Cards in their learning steps as due reviews, even when their step ends later today", () => {
    const learning: PlanCheckCard[] = Array.from({ length: 6 }, (_, i) => ({
      ...NEW_MEMORY_STATE,
      id: `l${i}`,
      createdAt: new Date(Date.UTC(2026, 0, 1)),
      state: "learning",
      dueAt: new Date("2026-05-31T20:00:00Z"),
      stability: 2,
      difficulty: 5,
      reps: 1,
      learningStep: 1,
      lastReviewAt: new Date("2026-05-31T11:50:00Z"),
    }));

    const result = checkPlan(input({ cards: [...learning, ...newCards(10)] }), 5);

    expect(result.unlearned).toBe(6);
  });

  test("carries the reviews that don't fit over to the next day, before its New cards", () => {
    const cards = [...reviewCards(40), ...newCards(10)];

    const result = checkPlan(input({ cards, deadline: addStudyDays(TODAY, 2) }), 5);

    // Today: 30 reviews fill 300 s. Tomorrow: the 10 left take 100 s, and
    // 200 s leaves 3 New cards.
    expect(result.unlearned).toBe(7);
  });

  test("leaves a review not due before the Deadline out", () => {
    const cards = [...reviewCards(30, new Date("2026-06-02T04:00:00Z")), ...newCards(10)];

    const result = checkPlan(input({ cards }), 5);

    expect(result.unlearned).toBe(5);
  });

  test("counts today's budget as what the Deck's Reviews today left of the goal", () => {
    const reviews = [
      // 2 minutes, and 10 minutes counted as 2: 4 of today's 5 minutes.
      timed("a", new Date("2026-05-31T05:00:00Z"), 2 * 60_000),
      timed("b", new Date("2026-05-31T06:00:00Z"), 10 * 60_000),
      // Before today's Day start, in another Deck, and not yet: none of them count.
      timed("c", new Date("2026-05-31T03:59:00Z"), 2 * 60_000),
      timed("d", new Date("2026-05-31T07:00:00Z"), 2 * 60_000, { deckId: "other" }),
      timed("e", new Date("2026-05-31T13:00:00Z"), 2 * 60_000),
    ];

    const result = checkPlan(input({ cards: newCards(10), reviews }), 5);

    // 60 s left today: 1 New card.
    expect(result.unlearned).toBe(9);
  });

  test("gives no budget today once the Deck's Reviews used up the goal", () => {
    const reviews = Array.from({ length: 4 }, (_, i) =>
      timed(`a${i}`, new Date("2026-05-31T05:00:00Z"), 2 * 60_000),
    );

    expect(checkPlan(input({ cards: newCards(10), reviews }), 5).unlearned).toBe(10);
  });

  test("brings Cards rated Good back as due reviews before the Deadline", () => {
    const deadline = addStudyDays(TODAY, 10);

    const result = checkPlan(input({ cards: newCards(60), deadline }), 5);

    // 5 New cards a day for 10 days would be 50, leaving 10; their reviews
    // coming due take some of the later days' budgets.
    expect(result.unlearned).toBeGreaterThan(10);
  });

  test("times the Cards by the User's averages in every Deck", () => {
    // 20 Card-days of New cards at 30 s, yesterday, in another Deck.
    const reviews = Array.from({ length: 20 }, (_, i) =>
      timed(`x${i}`, new Date(now.getTime() - DAY_MS), 30_000, {
        deckId: "other",
        wasNew: true,
      }),
    );

    expect(checkPlan(input({ cards: newCards(20), reviews }), 5).unlearned).toBe(10);
  });

  test("keeps the default timings below 20 Card-days", () => {
    const reviews = Array.from({ length: 19 }, (_, i) =>
      timed(`x${i}`, new Date(now.getTime() - DAY_MS), 30_000, {
        deckId: "other",
        wasNew: true,
      }),
    );

    expect(checkPlan(input({ cards: newCards(20), reviews }), 5).unlearned).toBe(15);
  });

  test("answers the smallest multiple of 5 minutes that covers the New cards", () => {
    // 23 New cards in one day take 23 minutes.
    const cards = newCards(23);

    expect(checkPlan(input({ cards }), 20)).toEqual({
      newCards: 23,
      unlearned: 3,
      neededMinutes: 25,
    });
    expect(checkPlan(input({ cards }), 25).unlearned).toBe(0);
  });

  test("answers the smallest covering goal also when the goal covers them", () => {
    expect(checkPlan(input({ cards: newCards(23) }), 120)).toEqual({
      newCards: 23,
      unlearned: 0,
      neededMinutes: 25,
    });
  });

  test("answers no needed minutes when even 600 leaves some", () => {
    expect(checkPlan(input({ cards: newCards(700) }), 600)).toEqual({
      newCards: 700,
      unlearned: 100,
      neededMinutes: null,
    });
  });

  test("answers nothing to learn for an empty Deck", () => {
    expect(checkPlan(input({ cards: [] }), 30)).toEqual({
      newCards: 0,
      unlearned: 0,
      neededMinutes: 5,
    });
  });

  test("answers nothing to learn for a Deck with no New cards", () => {
    expect(checkPlan(input({ cards: reviewCards(50) }), 5)).toEqual({
      newCards: 0,
      unlearned: 0,
      neededMinutes: 5,
    });
  });

  test("introduces the New cards in the order they were written", () => {
    // Written in reverse of their IDs: still the same count either way, but
    // the simulation must not fail on the order.
    const cards = newCards(10).map((card, i) => ({
      ...card,
      createdAt: new Date(Date.UTC(2026, 0, 1) - i),
    }));

    expect(checkPlan(input({ cards }), 5).unlearned).toBe(5);
  });

  test("checks a Deadline 2 years out quickly enough to run as the User types", () => {
    const cards = [...reviewCards(500), ...newCards(1500)];
    const started = performance.now();

    const result = checkPlan(input({ cards, deadline: addStudyDays(TODAY, 730) }), 5);

    expect(result.newCards).toBe(1500);
    expect(performance.now() - started).toBeLessThan(5_000);
  }, 20_000);
});
