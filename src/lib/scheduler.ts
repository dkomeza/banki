import { createEmptyCard, fsrs, Rating, State, type Card as FsrsCard, type Grade } from "ts-fsrs";
import type { StoredCard } from "@/lib/db/schema";

export const RATING_LABELS = {
  [Rating.Again]: "Again",
  [Rating.Hard]: "Hard",
  [Rating.Good]: "Good",
  [Rating.Easy]: "Easy",
} as const;

export function createScheduler(weights?: number[] | null, retention = 0.9) {
  return fsrs({
    request_retention: retention,
    ...(weights?.length === 21 ? { w: weights } : {}),
    enable_fuzz: false,
  });
}

export function storedToFsrs(card: StoredCard): FsrsCard {
  if (card.reps === 0) return createEmptyCard(new Date(card.due));
  return {
    due: new Date(card.due),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: 0,
    scheduled_days: card.scheduledDays,
    learning_steps: card.learningSteps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state as State,
    ...(card.lastReview ? { last_review: new Date(card.lastReview) } : {}),
  };
}

export function serializeFsrsCard(card: FsrsCard) {
  return {
    due: card.due.getTime(),
    stability: card.stability,
    difficulty: card.difficulty,
    scheduledDays: card.scheduled_days,
    learningSteps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    lastReview: card.last_review?.getTime() ?? null,
    updatedAt: Date.now(),
  };
}

export function applyRating(card: StoredCard, rating: Grade, now = new Date(), weights?: number[] | null, retention = 0.9) {
  return createScheduler(weights, retention).next(storedToFsrs(card), now, rating);
}

export function retrievability(card: StoredCard, at: Date, weights?: number[] | null, retention = 0.9) {
  if (card.reps === 0) return 0;
  return createScheduler(weights, retention).get_retrievability(storedToFsrs(card), at, false);
}

export function isGrade(value: number): value is Grade {
  return value >= Rating.Again && value <= Rating.Easy;
}
