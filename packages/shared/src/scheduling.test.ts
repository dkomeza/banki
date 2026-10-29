import { describe, expect, test } from "bun:test";
import { DesiredRetention, ReviewRequest } from "./scheduling";

describe("DesiredRetention", () => {
  test.each([70, 90, 97])("takes %d", (value) => {
    expect(DesiredRetention.parse(value)).toBe(value);
  });

  test.each([69, 98, 89.5, "90", null])("refuses %j", (value) => {
    expect(DesiredRetention.safeParse(value).success).toBe(false);
  });
});

describe("ReviewRequest", () => {
  test("takes each Rating with a whole, non-negative duration", () => {
    for (const rating of ["again", "hard", "good", "easy"] as const) {
      expect(ReviewRequest.parse({ rating, durationMs: 0 })).toEqual({ rating, durationMs: 0 });
    }
    expect(ReviewRequest.parse({ rating: "good", durationMs: 600_000 }).durationMs).toBe(600_000);
  });

  test.each([
    {},
    { rating: "good" },
    { rating: "Good", durationMs: 1 },
    { rating: "good", durationMs: -1 },
    { rating: "good", durationMs: 0.5 },
    { rating: "good", durationMs: 1, kind: "graded" },
  ])("refuses %j", (body) => {
    expect(ReviewRequest.safeParse(body).success).toBe(false);
  });
});
