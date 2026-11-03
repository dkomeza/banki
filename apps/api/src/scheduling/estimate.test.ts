import { describe, expect, test } from "bun:test";
import {
  DEFAULT_NEW_MS,
  DEFAULT_REVIEW_MS,
  type TimedReview,
  cardDayAverages,
  estimateMs,
} from "./estimate";

const studyDay = { timezone: "UTC", dayStartHour: 4 };
const now = new Date("2026-05-31T12:00:00Z");
const DAY_MS = 24 * 60 * 60_000;

/** A Review of `cardId`, `daysAgo` Study days before `now`, at noon. */
const review = (
  cardId: string,
  daysAgo: number,
  durationMs: number,
  wasNew = false,
): TimedReview => ({
  cardId,
  reviewedAt: new Date(now.getTime() - daysAgo * DAY_MS),
  durationMs,
  wasNew,
});

/** One Review each of `count` Cards, today. */
const cardsOnce = (count: number, durationMs: number, wasNew = false, prefix = "c") =>
  Array.from({ length: count }, (_, i) => review(`${prefix}${i}`, 0, durationMs, wasNew));

const averages = (reviews: TimedReview[]) => cardDayAverages(reviews, { now, studyDay });

describe("cardDayAverages", () => {
  test("has the defaults with no Reviews", () => {
    expect(averages([])).toEqual({ reviewMs: DEFAULT_REVIEW_MS, newMs: DEFAULT_NEW_MS });
    expect(DEFAULT_REVIEW_MS).toBe(10_000);
    expect(DEFAULT_NEW_MS).toBe(60_000);
  });

  test("keeps a kind's default below 20 Card-days, and averages from 20", () => {
    expect(averages(cardsOnce(19, 4_000)).reviewMs).toBe(DEFAULT_REVIEW_MS);
    expect(averages(cardsOnce(20, 4_000)).reviewMs).toBe(4_000);
    expect(averages(cardsOnce(19, 30_000, true)).newMs).toBe(DEFAULT_NEW_MS);
    expect(averages(cardsOnce(20, 30_000, true)).newMs).toBe(30_000);
  });

  test("sums one Card's Reviews on a Study day into one Card-day", () => {
    // 20 Cards, each rated twice today: 20 Card-days of 3 s + 5 s.
    const reviews = [...cardsOnce(20, 3_000), ...cardsOnce(20, 5_000)];

    expect(averages(reviews).reviewMs).toBe(8_000);
  });

  test("counts one Card on two Study days as two Card-days", () => {
    // 10 Cards, each on two days: 20 Card-days.
    const reviews = Array.from({ length: 10 }, (_, i) => [
      review(`c${i}`, 0, 6_000),
      review(`c${i}`, 1, 6_000),
    ]).flat();

    expect(averages(reviews).reviewMs).toBe(6_000);
  });

  test("counts the Study day of a New card's first Review as New, its learning steps included", () => {
    // Each Card: its first Review (New), then a learning step the same day,
    // then a review the next day.
    const reviews = Array.from({ length: 20 }, (_, i) => [
      review(`c${i}`, 1, 20_000, true),
      review(`c${i}`, 1, 10_000),
      review(`c${i}`, 0, 7_000),
    ]).flat();

    expect(averages(reviews)).toEqual({ reviewMs: 7_000, newMs: 30_000 });
  });

  test("counts each Review for at most 2 minutes", () => {
    const reviews = [...cardsOnce(20, 10 * 60_000), ...cardsOnce(20, 30_000)];

    expect(averages(reviews).reviewMs).toBe(150_000);
  });

  test("looks back 30 Study days, today included", () => {
    const inWindow = Array.from({ length: 20 }, (_, i) => review(`in${i}`, 29, 5_000));
    const outside = Array.from({ length: 20 }, (_, i) => review(`out${i}`, 30, 50_000));

    expect(averages([...inWindow, ...outside]).reviewMs).toBe(5_000);
    expect(averages(outside).reviewMs).toBe(DEFAULT_REVIEW_MS);
  });

  test("groups by Study day, so a Review before the Day start counts for the day before", () => {
    // 03:00 is before today's 04:00 Day start: the same Study day as yesterday noon.
    const early = new Date("2026-05-31T03:00:00Z");
    const reviews = Array.from({ length: 20 }, (_, i) => [
      review(`c${i}`, 1, 4_000),
      { cardId: `c${i}`, reviewedAt: early, durationMs: 4_000, wasNew: false },
    ]).flat();

    expect(averages(reviews).reviewMs).toBe(8_000);
  });
});

describe("estimateMs", () => {
  test("is due Cards at the review rate plus New cards at the New rate", () => {
    expect(estimateMs({ due: 12, fresh: 20 }, { reviewMs: 10_000, newMs: 60_000 })).toBe(
      12 * 10_000 + 20 * 60_000,
    );
  });

  test("is 0 with nothing to study", () => {
    expect(estimateMs({ due: 0, fresh: 0 }, { reviewMs: 10_000, newMs: 60_000 })).toBe(0);
  });
});
