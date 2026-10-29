import { describe, expect, test } from "bun:test";
import { StudyNextQuery, StudyNextResponse, UndoReviewResponse } from "./study";

describe("StudyNextQuery", () => {
  test("counts nothing shown when the counters are left out", () => {
    expect(StudyNextQuery.parse({})).toEqual({ reviewsShown: 0, newShown: 0, after: undefined });
  });

  test("takes whole numbers from 0, and the Card just shown", () => {
    expect(StudyNextQuery.parse({ reviewsShown: "12", newShown: "0", after: "c1" })).toEqual({
      reviewsShown: 12,
      newShown: 0,
      after: "c1",
    });
  });

  test("takes an empty `after` as none", () => {
    expect(StudyNextQuery.parse({ after: "" }).after).toBeUndefined();
  });

  test.each([
    { reviewsShown: "-1" },
    { reviewsShown: "1.5" },
    { reviewsShown: "" },
    { reviewsShown: "abc" },
    { newShown: "1e3" },
    { newShown: " 1" },
    { newShown: "99999999999999999999" },
  ])("refuses %j", (query) => {
    expect(StudyNextQuery.safeParse(query).success).toBe(false);
  });
});

const preview = (state: string, scheduledDays: number) => ({
  state,
  scheduledDays,
  due: "2026-05-01T10:10:00.000Z",
});

describe("StudyNextResponse", () => {
  const card = {
    id: "c1",
    deckId: "d1",
    front: "f",
    back: "b",
    tags: [],
    createdAt: "2026-05-01T10:00:00.000Z",
    updatedAt: "2026-05-01T10:00:00.000Z",
  };
  const schedule = {
    state: "new",
    due: null,
    stability: 0,
    difficulty: 0,
    reps: 0,
    lapses: 0,
    scheduledDays: 0,
    lastReview: null,
  };
  const intervals = {
    again: preview("learning", 0),
    hard: preview("learning", 0),
    good: preview("learning", 0),
    easy: preview("review", 3),
  };

  test("takes a next Card of each kind, or none", () => {
    for (const kind of ["new", "learning", "review"]) {
      expect(
        StudyNextResponse.safeParse({ next: { card, schedule, kind, intervals } }).success,
      ).toBe(true);
    }
    expect(StudyNextResponse.parse({ next: null })).toEqual({ next: null });
  });

  test("refuses another kind, or no next at all", () => {
    expect(
      StudyNextResponse.safeParse({ next: { card, schedule, kind: "due", intervals } }).success,
    ).toBe(false);
    expect(StudyNextResponse.safeParse({}).success).toBe(false);
  });

  test("refuses a next Card without its Interval previews, or with one missing", () => {
    expect(StudyNextResponse.safeParse({ next: { card, schedule, kind: "new" } }).success).toBe(
      false,
    );
    const { easy: _, ...three } = intervals;
    expect(
      StudyNextResponse.safeParse({ next: { card, schedule, kind: "new", intervals: three } })
        .success,
    ).toBe(false);
  });

  test("an Undo answers the Card, its schedule and its Interval previews", () => {
    expect(UndoReviewResponse.safeParse({ card, schedule, intervals }).success).toBe(true);
    expect(UndoReviewResponse.safeParse({ card, schedule }).success).toBe(false);
  });
});
