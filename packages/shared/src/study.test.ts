import { describe, expect, test } from "bun:test";
import { StudyNextQuery, StudyNextResponse, UndoReviewResponse } from "./study";

describe("StudyNextQuery", () => {
  test("counts nothing shown when the counters are left out", () => {
    expect(StudyNextQuery.parse({})).toEqual({
      reviewsShown: 0,
      newShown: 0,
      batches: 1,
      after: undefined,
    });
  });

  test("takes whole numbers from 0, and the Card just shown", () => {
    expect(StudyNextQuery.parse({ reviewsShown: "12", newShown: "0", after: "c1" })).toEqual({
      reviewsShown: 12,
      newShown: 0,
      batches: 1,
      after: "c1",
    });
  });

  test("takes the batches given as a whole number from 1", () => {
    expect(StudyNextQuery.parse({ batches: "1" }).batches).toBe(1);
    expect(StudyNextQuery.parse({ batches: "3" }).batches).toBe(3);
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
    { batches: "0" },
    { batches: "-1" },
    { batches: "1.5" },
    { batches: "01" },
    { batches: "" },
    { batches: "99999999999999999999" },
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
    gradingNotes: null,
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
        StudyNextResponse.safeParse({ next: { card, schedule, kind, intervals }, newHeld: 0 })
          .success,
      ).toBe(true);
    }
    expect(StudyNextResponse.parse({ next: null, newHeld: 0 })).toEqual({ next: null, newHeld: 0 });
  });

  test("says how many New cards the batch held back", () => {
    expect(StudyNextResponse.parse({ next: null, newHeld: 37 }).newHeld).toBe(37);
    expect(StudyNextResponse.safeParse({ next: null }).success).toBe(false);
    expect(StudyNextResponse.safeParse({ next: null, newHeld: -1 }).success).toBe(false);
    expect(StudyNextResponse.safeParse({ next: null, newHeld: 1.5 }).success).toBe(false);
  });

  test("refuses another kind, or no next at all", () => {
    expect(
      StudyNextResponse.safeParse({ next: { card, schedule, kind: "due", intervals }, newHeld: 0 })
        .success,
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
