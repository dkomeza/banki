import { describe, expect, it } from "vitest";
import { Rating } from "ts-fsrs";
import { buildForecast, rankCards } from "@/lib/planner";
import { applyRating, serializeFsrsCard } from "@/lib/scheduler";
import type { StoredCard } from "@/lib/db/schema";

function card(id: string, due: number): StoredCard {
  return { id, deckId: "deck", sourceGuid: null, frontHtml: id, backHtml: id, tags: "[]", position: 0, due, stability: 0, difficulty: 0, scheduledDays: 0, learningSteps: 0, reps: 0, lapses: 0, state: 0, lastReview: null, createdAt: due, updatedAt: due };
}

describe("deadline planner", () => {
  it("prioritizes a due card over an otherwise identical future card", () => {
    const now = new Date("2026-06-21T10:00:00Z");
    const due = card("due", now.getTime() - 1);
    const future = card("future", now.getTime() + 86_400_000);
    expect(rankCards([future, due], now, new Date("2026-06-24T21:00:00Z"))[0].card.id).toBe("due");
  });

  it("raises forecast recall when budget can fund a review", () => {
    const now = new Date("2026-06-21T10:00:00Z");
    const fresh = card("new", now.getTime());
    const reviewedState = serializeFsrsCard(applyRating(fresh, Rating.Good, now).card);
    const reviewed = { ...fresh, ...reviewedState };
    const forecast = buildForecast([reviewed], now, new Date("2026-06-24T21:00:00Z"), 30);
    expect(forecast.predictedRecall).toBeGreaterThan(0);
    expect(forecast.capacityReviews).toBe(1);
  });
});
