import { describe, expect, test } from "bun:test";
import {
  DesiredRetention,
  REVIEW_CAP_MS,
  REVIEW_MODEL_MAX_LENGTH,
  ReviewRequest,
  ReviewResponse,
} from "./scheduling";

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
    expect(ReviewRequest.parse({ rating: "good", durationMs: 120_000 }).durationMs).toBe(120_000);
  });

  test("takes a duration above the cap as the cap, 2 minutes", () => {
    expect(REVIEW_CAP_MS).toBe(120_000);
    expect(ReviewRequest.parse({ rating: "good", durationMs: 120_001 }).durationMs).toBe(120_000);
    expect(ReviewRequest.parse({ rating: "good", durationMs: 600_000 }).durationMs).toBe(120_000);
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

  test("takes a suggested Rating with the Model that suggested it", () => {
    const body = {
      rating: "hard" as const,
      durationMs: 5,
      suggestedRating: "good" as const,
      model: "anthropic/claude-haiku-5.5",
    };
    expect(ReviewRequest.parse(body)).toEqual(body);
  });

  test.each(["x", "not/a-curated-model", "m".repeat(REVIEW_MODEL_MAX_LENGTH)])(
    "takes any Model ID up to 200 characters: %s",
    (model) => {
      const body = { rating: "good", durationMs: 1, suggestedRating: "good", model };
      expect(ReviewRequest.parse(body).model).toBe(model);
    },
  );

  test.each([
    { suggestedRating: "good" },
    { model: "anthropic/claude-haiku-5.5" },
    { suggestedRating: "Good", model: "anthropic/claude-haiku-5.5" },
    { suggestedRating: null, model: "anthropic/claude-haiku-5.5" },
    { suggestedRating: "good", model: "" },
    { suggestedRating: "good", model: "m".repeat(REVIEW_MODEL_MAX_LENGTH + 1) },
    { suggestedRating: "good", model: null },
  ])("refuses a suggestion that isn't whole and valid: %j", (suggestion) => {
    expect(ReviewRequest.safeParse({ rating: "good", durationMs: 1, ...suggestion }).success).toBe(
      false,
    );
  });
});

describe("ReviewResponse", () => {
  const review = {
    id: "r",
    cardId: "c",
    deckId: "d",
    reviewedAt: "2026-11-09T12:00:00.000Z",
    rating: "good" as const,
    durationMs: 1,
  };

  test("takes a graded Review with its suggestion, and a self-rated one with neither", () => {
    const graded = {
      ...review,
      kind: "graded" as const,
      suggestedRating: "hard" as const,
      model: "anthropic/claude-haiku-5.5",
    };
    const selfRated = {
      ...review,
      kind: "self-rated" as const,
      suggestedRating: null,
      model: null,
    };
    expect(ReviewResponse.parse(graded)).toEqual(graded);
    expect(ReviewResponse.parse(selfRated)).toEqual(selfRated);
  });
});
