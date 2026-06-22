import { Rating, State, type Grade } from "ts-fsrs";
import type { StoredCard } from "@/lib/db/schema";
import { createScheduler, storedToFsrs } from "@/lib/scheduler";
import { daysUntil } from "@/lib/time";

const OUTCOMES: Array<[Grade, number]> = [
  [Rating.Again, 0.1],
  [Rating.Hard, 0.15],
  [Rating.Good, 0.65],
  [Rating.Easy, 0.1],
];

export type RankedCard = {
  card: StoredCard;
  currentRecall: number;
  expectedRecall: number;
  gainPerSecond: number;
  estimatedSeconds: number;
};

export type Forecast = {
  expectedRemembered: number;
  predictedRecall: number;
  currentRecall: number;
  daysRemaining: number;
  capacityReviews: number;
  cardsNotIntroduced: number;
  rankedCards: RankedCard[];
  horizon: Array<{ label: string; recall: number }>;
};

export function rankCards(
  cards: StoredCard[],
  now: Date,
  deadline: Date,
  reviewSeconds = 12,
  newSeconds = 35,
  weights?: number[] | null,
  retention = 0.9,
) {
  const scheduler = createScheduler(weights, retention);
  return cards.map((card): RankedCard => {
    const source = storedToFsrs(card);
    const currentRecall = card.reps === 0 ? 0 : scheduler.get_retrievability(source, deadline, false);
    const expectedRecall = OUTCOMES.reduce((sum, [rating, probability]) => {
      const next = scheduler.next(source, now, rating).card;
      return sum + probability * scheduler.get_retrievability(next, deadline, false);
    }, 0);
    const estimatedSeconds = card.reps === 0 ? newSeconds : reviewSeconds;
    const dueBoost = card.due <= now.getTime() || card.state === State.Learning || card.state === State.Relearning ? 1.25 : 1;
    return {
      card,
      currentRecall,
      expectedRecall,
      estimatedSeconds,
      gainPerSecond: (Math.max(0, expectedRecall - currentRecall) / estimatedSeconds) * dueBoost,
    };
  }).sort((a, b) => b.gainPerSecond - a.gainPerSecond || a.card.due - b.card.due);
}

export function buildForecast(
  cards: StoredCard[],
  now: Date,
  deadline: Date,
  dailyMinutes: number,
  reviewSeconds = 12,
  newSeconds = 35,
  weights?: number[] | null,
  retention = 0.9,
): Forecast {
  const rankedCards = rankCards(cards, now, deadline, reviewSeconds, newSeconds, weights, retention);
  const daysRemaining = daysUntil(deadline, now);
  const budgetSeconds = daysRemaining * dailyMinutes * 60;
  let spent = 0;
  const selected = new Set<string>();
  for (const candidate of rankedCards) {
    if (spent + candidate.estimatedSeconds > budgetSeconds) continue;
    spent += candidate.estimatedSeconds;
    selected.add(candidate.card.id);
  }
  const expectedRemembered = rankedCards.reduce(
    (sum, item) => sum + (selected.has(item.card.id) ? item.expectedRecall : item.currentRecall),
    0,
  );
  const currentRemembered = rankedCards.reduce((sum, item) => sum + item.currentRecall, 0);
  const scheduler = createScheduler(weights, retention);
  const checkpoints = [0, 0.25, 0.5, 0.75, 1];
  const horizon = checkpoints.map((fraction) => {
    const at = new Date(now.getTime() + (deadline.getTime() - now.getTime()) * fraction);
    const recall = cards.length
      ? cards.reduce((sum, card) => {
          const source = storedToFsrs(card);
          if (!selected.has(card.id)) return sum + (card.reps ? scheduler.get_retrievability(source, at, false) : 0);
          const expected = OUTCOMES.reduce((outcomeSum, [rating, probability]) => {
            const next = scheduler.next(source, now, rating).card;
            return outcomeSum + probability * scheduler.get_retrievability(next, at, false);
          }, 0);
          return sum + expected;
        }, 0) / cards.length
      : 0;
    return { label: fraction === 0 ? "Now" : fraction === 1 ? "Deadline" : `${Math.round(fraction * 100)}%`, recall };
  });
  return {
    expectedRemembered,
    predictedRecall: cards.length ? expectedRemembered / cards.length : 0,
    currentRecall: cards.length ? currentRemembered / cards.length : 0,
    daysRemaining,
    capacityReviews: selected.size,
    cardsNotIntroduced: rankedCards.filter((item) => item.card.reps === 0 && !selected.has(item.card.id)).length,
    rankedCards,
    horizon,
  };
}
