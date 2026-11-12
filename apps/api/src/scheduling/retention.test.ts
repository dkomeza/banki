import { describe, expect, test } from "bun:test";
import type { Rating } from "@banki/shared";
import { DEFAULT_PARAMETERS } from "./fsrs";
import {
  DEFAULT_RETENTION_INPUTS,
  MIN_RETENTION_CARD_DAYS,
  type RatedReview,
  type RetentionInputs,
  recommendedRetention,
  retentionInputs,
} from "./retention";

const studyDay = { timezone: "UTC", dayStartHour: 4 };
const DAY_MS = 24 * 60 * 60_000;
const start = new Date("2026-05-01T12:00:00Z");

let seq = 0;
/** A Review of `cardId` on Study day `day` after `start`, `minute` minutes past noon. */
const review = (
  cardId: string,
  day: number,
  rating: Rating,
  durationMs: number,
  { wasNew = false, minute = 0 } = {},
): RatedReview => ({
  cardId,
  seq: ++seq,
  reviewedAt: new Date(start.getTime() + day * DAY_MS + minute * 60_000),
  rating,
  durationMs,
  wasNew,
});

const inputs = (reviews: RatedReview[]) => retentionInputs(reviews, studyDay);

/** `count` Card-days of their own Cards, each from `make`. */
const days = (count: number, make: (cardId: string) => RatedReview[]) =>
  Array.from({ length: count }, (_, i) => make(`c${i}-${seq}`)).flat();

describe("retentionInputs", () => {
  test("has fsrs-rs's simulator defaults with no Reviews", () => {
    expect(inputs([])).toEqual(DEFAULT_RETENTION_INPUTS);
    expect(DEFAULT_RETENTION_INPUTS).toEqual({
      newDayMs: 18_277,
      recallDayMs: 8_054,
      againDayMs: 23_000,
      firstRatings: [0.24, 0.094, 0.495, 0.171],
      recallRatings: [0.224, 0.631, 0.145],
    });
  });

  test("splits Card-days into a New card's first day, recalled and Again review days", () => {
    const reviews = [
      // New on day 0: Again, then its two learning steps.
      ...days(20, (id) => [
        review(id, 0, "again", 10_000, { wasNew: true }),
        review(id, 0, "good", 5_000, { minute: 1 }),
        review(id, 0, "good", 5_000, { minute: 11 }),
      ]),
      // Review days whose first Rating is Hard, then Good the same day.
      ...days(20, (id) => [
        review(id, 3, "hard", 6_000),
        review(id, 3, "good", 2_000, { minute: 5 }),
      ]),
      // Review days whose first Rating is Again, then the relearning step.
      ...days(20, (id) => [
        review(id, 5, "again", 30_000),
        review(id, 5, "good", 10_000, { minute: 10 }),
      ]),
    ];

    expect(inputs(reviews)).toEqual({
      newDayMs: 20_000,
      recallDayMs: 8_000,
      againDayMs: 40_000,
      firstRatings: [1, 0, 0, 0],
      recallRatings: [1, 0, 0],
    });
  });

  test("counts one Card on two Study days as two Card-days", () => {
    const reviews = days(10, (id) => [
      review(id, 0, "good", 4_000, { wasNew: true }),
      review(id, 2, "easy", 3_000),
      review(id, 7, "good", 5_000),
    ]);
    // 10 New days, and 20 review days: 10 Easy and 10 Good.
    expect(inputs(reviews).recallDayMs).toBe(4_000);
    expect(inputs(reviews).recallRatings).toEqual([0, 0.5, 0.5]);
    expect(inputs(reviews).newDayMs).toBe(DEFAULT_RETENTION_INPUTS.newDayMs);
  });

  test("works out the first-Rating mix of New cards", () => {
    const reviews = [
      ...days(5, (id) => [review(id, 0, "again", 1_000, { wasNew: true })]),
      ...days(5, (id) => [review(id, 0, "hard", 1_000, { wasNew: true })]),
      ...days(10, (id) => [review(id, 0, "easy", 1_000, { wasNew: true })]),
    ];
    expect(inputs(reviews).firstRatings).toEqual([0.25, 0.25, 0, 0.5]);
  });

  test("keeps each figure's default below 20 Card-days, and its own from 20", () => {
    const n = MIN_RETENTION_CARD_DAYS;
    const few = [
      ...days(n - 1, (id) => [review(id, 0, "good", 1_000, { wasNew: true })]),
      ...days(n - 1, (id) => [review(id, 4, "good", 1_000)]),
      ...days(n - 1, (id) => [review(id, 4, "again", 1_000)]),
    ];
    expect(inputs(few)).toEqual(DEFAULT_RETENTION_INPUTS);

    const enough = [
      ...days(n, (id) => [review(id, 0, "good", 1_000, { wasNew: true })]),
      ...days(n - 1, (id) => [review(id, 4, "good", 1_000)]),
      ...days(n, (id) => [review(id, 4, "again", 1_000)]),
    ];
    expect(inputs(enough)).toEqual({
      ...DEFAULT_RETENTION_INPUTS,
      newDayMs: 1_000,
      firstRatings: [0, 0, 1, 0],
      againDayMs: 1_000,
    });
  });

  test("counts each Review for at most 2 minutes", () => {
    const reviews = days(20, (id) => [
      review(id, 4, "good", 10 * 60_000),
      review(id, 4, "good", 0),
    ]);
    expect(inputs(reviews).recallDayMs).toBe(120_000);
  });

  test("groups by Study day, not by the calendar day", () => {
    // 03:00 belongs to the Study day before, with a 04:00 Day start.
    const reviews = days(20, (id) => [
      { ...review(id, 4, "again", 3_000), reviewedAt: new Date("2026-05-05T23:00:00Z") },
      { ...review(id, 4, "good", 3_000), reviewedAt: new Date("2026-05-06T03:00:00Z") },
    ]);
    expect(inputs(reviews).againDayMs).toBe(6_000);
  });

  test("takes Reviews in the Write order, whatever order they come in", () => {
    const reviews = days(20, (id) => [
      review(id, 4, "again", 3_000),
      review(id, 4, "good", 1_000, { minute: 10 }),
    ]).toReversed();
    expect(inputs(reviews).againDayMs).toBe(4_000);
    expect(inputs(reviews).recallDayMs).toBe(DEFAULT_RETENTION_INPUTS.recallDayMs);
  });
});

/** The Recommended retention under FSRS-6's defaults, with the default inputs but `changes`. */
const recommend = (changes: Partial<RetentionInputs> = {}) =>
  recommendedRetention(DEFAULT_PARAMETERS, { ...DEFAULT_RETENTION_INPUTS, ...changes });

describe("recommendedRetention", () => {
  test("gives the same answer for the same inputs", async () => {
    const changes = { againDayMs: 120_000 };
    expect(await recommend(changes)).toBe(await recommend(changes));
  });

  test("is always a whole percent from 70 to 97", async () => {
    const cases: Partial<RetentionInputs>[] = [
      {},
      { againDayMs: 1 },
      { againDayMs: 10 * 60_000 },
      { recallDayMs: 1, newDayMs: 10 * 60_000 },
      { recallDayMs: 10 * 60_000, newDayMs: 1 },
      { newDayMs: 0, recallDayMs: 0, againDayMs: 0 },
      { firstRatings: [1, 0, 0, 0], recallRatings: [1, 0, 0] },
      { firstRatings: [0, 0, 0, 1], recallRatings: [0, 0, 1] },
    ];
    for (const changes of cases) {
      const percent = await recommend(changes);
      expect(Number.isInteger(percent)).toBe(true);
      expect(percent).toBeGreaterThanOrEqual(70);
      expect(percent).toBeLessThanOrEqual(97);
    }
  });

  test("goes up when an Again day costs more", async () => {
    const cheap = await recommend({ againDayMs: 23_000 });
    const costly = await recommend({ againDayMs: 240_000 });
    expect(costly).toBeGreaterThan(cheap);
  });

  test("goes down when a review day costs more, relative to a New card's day", async () => {
    const cheap = await recommend({ recallDayMs: 2_000 });
    const costly = await recommend({ recallDayMs: 8_000 });
    expect(costly).toBeLessThan(cheap);
  });

  test("takes the lower percent on a tie", async () => {
    // Nothing costs anything: every percent scores 0, so 70 wins.
    expect(await recommend({ newDayMs: 0, recallDayMs: 0, againDayMs: 0 })).toBe(70);
  });
});

describe("on a history the size of a real one", () => {
  test("works out the inputs and the recommendation from 48,000 Reviews within a few seconds", async () => {
    // 4,000 Cards with 12 Reviews each, as BAN-54's real-data fixture had 48,000.
    const ratings: Rating[] = ["again", "hard", "good", "easy"];
    const reviews = Array.from({ length: 4000 }, (_card, c) =>
      Array.from({ length: 12 }, (_review, k) =>
        review(`c${c}`, (c % 365) + k * k * 3, ratings[(c * 7 + k * 3) % 4] ?? "good", 3_000, {
          wasNew: k === 0,
          minute: k,
        }),
      ),
    ).flat();

    const started = performance.now();
    const percent = await recommendedRetention(
      DEFAULT_PARAMETERS,
      retentionInputs(reviews, { timezone: "Europe/Warsaw", dayStartHour: 4 }),
    );
    const ms = performance.now() - started;

    expect(percent).toBeGreaterThanOrEqual(70);
    expect(ms).toBeLessThan(5_000);
  });
});
