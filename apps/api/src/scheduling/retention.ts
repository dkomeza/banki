import {
  DESIRED_RETENTION_MAX,
  DESIRED_RETENTION_MIN,
  type Rating,
  type StudyDaySettings,
} from "@banki/shared";
import { FSRS6Model } from "ts-fsrs/models/fsrs-6";
import { cardDayMs, cardDaysOf } from "./estimate";
import type { Parameters } from "./fsrs";

// Recommended retention (CONTEXT.md, ADR-0032): the Desired retention that
// leaves the User remembering the most Cards per minute studied. A year of
// study is simulated at each whole percent from 70 to 97, one Card at a time
// (Banki sets no daily limits, so Cards never compete for a day's time),
// under the User's Parameters with their own time per Card-day and Rating
// mix. Modelled on fsrs-rs's `simulate`, without its daily limits.

/** A Review as the simulator's inputs are worked out from it. */
export type RatedReview = {
  cardId: string;
  seq: number;
  reviewedAt: Date;
  rating: Rating;
  durationMs: number;
  /** Whether the Card was New when it was rated. */
  wasNew: boolean;
};

/** What the simulator takes from the User's Reviews. Mixes are shares summing to 1. */
export type RetentionInputs = {
  /** The average time of a New card's first Study day, its learning steps included. */
  newDayMs: number;
  /** The average time of a review Card-day whose first Rating wasn't Again. */
  recallDayMs: number;
  /** The average time of a review Card-day whose first Rating was Again. */
  againDayMs: number;
  /** The first Rating of New cards: Again, Hard, Good, Easy. */
  firstRatings: readonly [number, number, number, number];
  /** The first Rating of recalled review Card-days: Hard, Good, Easy. */
  recallRatings: readonly [number, number, number];
};

/** How many Card-days a figure needs before the User's own replaces the default. */
export const MIN_RETENTION_CARD_DAYS = 20;

// fsrs-rs's simulator defaults (SimulatorConfig::default, fsrs-rs 6.5).
const LEARN_COSTS_S = [33.79, 24.3, 13.68, 6.5] as const;
const REVIEW_COSTS_S = [23.0, 11.68, 7.33, 5.6] as const;
const FIRST_RATINGS = [0.24, 0.094, 0.495, 0.171] as const;
const RECALL_RATINGS = [0.224, 0.631, 0.145] as const;

const weighted = (costs: readonly number[], shares: readonly number[]) =>
  costs.reduce((sum, cost, i) => sum + cost * (shares[i] ?? 0), 0);

/**
 * The inputs with no Reviews to go on: fsrs-rs's simulator defaults, a New
 * card's day its learn costs over its first-Rating mix, a recalled day its
 * review costs over its Hard/Good/Easy mix, and an Again day its Again cost.
 */
export const DEFAULT_RETENTION_INPUTS: RetentionInputs = {
  newDayMs: Math.round(weighted(LEARN_COSTS_S, FIRST_RATINGS) * 1000),
  recallDayMs: Math.round(weighted(REVIEW_COSTS_S.slice(1), RECALL_RATINGS) * 1000),
  againDayMs: REVIEW_COSTS_S[0] * 1000,
  firstRatings: FIRST_RATINGS,
  recallRatings: RECALL_RATINGS,
};

const enough = (days: readonly unknown[]) => days.length >= MIN_RETENTION_CARD_DAYS;

const average = (values: readonly number[]) =>
  values.reduce((sum, value) => sum + value, 0) / values.length;

/** The share of each of `ratings` in `firsts`. */
const mixOf = (firsts: readonly Rating[], ratings: readonly Rating[]) =>
  ratings.map((rating) => firsts.filter((first) => first === rating).length / firsts.length);

/**
 * The simulator's inputs from `reviews`, all of the User's of every kind,
 * of Cards that are gone too, by Card-day under `studyDay`: one Card's
 * Reviews on one Study day, in the Write order, each counted for at most 2
 * minutes. A Card-day with a Review of the Card while New is a New card's
 * first day, and its first such Review's Rating is the Card's first; any
 * other is a review Card-day, recalled unless its first Rating was Again. A
 * figure from fewer than 20 Card-days has its default
 * (`DEFAULT_RETENTION_INPUTS`); a mix goes with its Card-days' kind.
 */
export function retentionInputs(
  reviews: readonly RatedReview[],
  studyDay: StudyDaySettings,
): RetentionInputs {
  const ordered = reviews.toSorted((a, b) => a.seq - b.seq);
  const newDays: { ms: number; first: Rating }[] = [];
  const recallDays: { ms: number; first: Rating }[] = [];
  const againDays: number[] = [];
  for (const { reviews: day } of cardDaysOf(ordered, studyDay)) {
    const ms = cardDayMs(day);
    const firstNew = day.find((review) => review.wasNew);
    if (firstNew !== undefined) newDays.push({ ms, first: firstNew.rating });
    else if (day[0]?.rating === "again") againDays.push(ms);
    else if (day[0] !== undefined) recallDays.push({ ms, first: day[0].rating });
  }
  const defaults = DEFAULT_RETENTION_INPUTS;
  const [again = 0, hard = 0, good = 0, easy = 0] = mixOf(
    newDays.map((d) => d.first),
    ["again", "hard", "good", "easy"],
  );
  const [recallHard = 0, recallGood = 0, recallEasy = 0] = mixOf(
    recallDays.map((d) => d.first),
    ["hard", "good", "easy"],
  );
  return {
    newDayMs: enough(newDays) ? average(newDays.map((d) => d.ms)) : defaults.newDayMs,
    recallDayMs: enough(recallDays) ? average(recallDays.map((d) => d.ms)) : defaults.recallDayMs,
    againDayMs: enough(againDays) ? average(againDays) : defaults.againDayMs,
    firstRatings: enough(newDays) ? [again, hard, good, easy] : defaults.firstRatings,
    recallRatings: enough(recallDays)
      ? [recallHard, recallGood, recallEasy]
      : defaults.recallRatings,
  };
}

/** How many Study days the simulation runs, New cards coming in evenly over them. */
export const SIMULATED_DAYS = 365;
/** How many Cards the simulation follows at each Desired retention. */
export const SIMULATED_CARDS = 4000;
const SEED = 0x5eed;

/** A seeded PRNG (mulberry32): the same seed gives the same draws, in [0, 1). */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** The index of the share `draw` falls in, of `shares` summing to 1. */
function pick(shares: readonly number[], draw: number): number {
  let total = 0;
  for (let i = 0; i < shares.length; i++) {
    total += shares[i] ?? 0;
    if (draw < total) return i;
  }
  return shares.length - 1;
}

type Grade = 1 | 2 | 3 | 4;
const AGAIN: Grade = 1;
const GOOD: Grade = 3;
/** The grades a first Rating and a recalled review's Rating are drawn from, in their mixes' order. */
const FIRST_GRADES: readonly Grade[] = [1, 2, 3, 4];
const RECALL_GRADES: readonly Grade[] = [2, 3, 4];
/**
 * The same-day Goods that take a New card through Banki's learning steps (1
 * min, 10 min) after its first Rating: Again and Hard leave it at the first
 * step, Good moves it to the second, Easy graduates it at once.
 */
const LEARNING_GOODS = [2, 2, 1, 0] as const;

type Model = ReturnType<typeof FSRS6Model.create>;
type Memory = { stability: number; difficulty: number };

/**
 * Simulates `cards` Cards for `SIMULATED_DAYS` Study days at `retention`, a
 * fraction: each comes in on its own day, evenly spread, and is reviewed
 * whenever it falls due. Answers the Cards remembered at the end (the sum of
 * their Predicted recall) and the minutes it all took. Each Card draws from
 * its own seeded PRNG, so every retention sees the same Cards and draws.
 */
function simulate(
  model: Model,
  inputs: RetentionInputs,
  retention: number,
  cards: number,
): { remembered: number; minutes: number } {
  let remembered = 0;
  let ms = 0;
  for (let i = 0; i < cards; i++) {
    const random = prng(SEED + i * 0x9e3779b1);
    const learnedOn = Math.floor((i * SIMULATED_DAYS) / cards);
    const first = FIRST_GRADES[pick(inputs.firstRatings, random())] ?? GOOD;
    let memory: Memory = model.step({ memoryState: null, rating: first, elapsedDays: 0 });
    for (let goods = LEARNING_GOODS[first - 1] ?? 0; goods > 0; goods--) {
      memory = model.step({ memoryState: memory, rating: GOOD, elapsedDays: 0 });
    }
    ms += inputs.newDayMs;
    let lastReview = learnedOn;
    let interval = model.nextInterval(memory, retention);
    while (lastReview + interval < SIMULATED_DAYS) {
      const recall = model.forgettingCurve(memory, interval);
      if (random() < recall) {
        const rating = RECALL_GRADES[pick(inputs.recallRatings, random())] ?? GOOD;
        memory = model.step({
          memoryState: memory,
          rating,
          elapsedDays: interval,
          retrievability: recall,
        });
        ms += inputs.recallDayMs;
      } else {
        memory = model.step({
          memoryState: memory,
          rating: AGAIN,
          elapsedDays: interval,
          retrievability: recall,
        });
        // Its relearning step (10 min), passed the same day.
        memory = model.step({ memoryState: memory, rating: GOOD, elapsedDays: 0 });
        ms += inputs.againDayMs;
      }
      lastReview += interval;
      interval = model.nextInterval(memory, retention);
    }
    remembered += model.forgettingCurve(memory, SIMULATED_DAYS - lastReview);
  }
  return { remembered, minutes: ms / 60_000 };
}

/**
 * The Recommended retention under `parameters` and `inputs`: the whole
 * percent from 70 to 97 whose simulated year (`simulate`) leaves the most
 * Cards remembered per minute studied, the lower one on a tie. FSRS-6 with
 * short-term memory and no fuzz, seeded, so the same inputs always give the
 * same answer. It yields to the event loop between percents, so a request
 * that comes in meanwhile never waits for the whole of it. `cards` is for
 * tests.
 */
export async function recommendedRetention(
  parameters: Parameters,
  inputs: RetentionInputs,
  { cards = SIMULATED_CARDS }: { cards?: number } = {},
): Promise<number> {
  const model = FSRS6Model.create({
    config: { weights: [...parameters], enableShortTerm: true, numRelearningSteps: 1 },
  });
  let best = DESIRED_RETENTION_MIN;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (let percent = DESIRED_RETENTION_MIN; percent <= DESIRED_RETENTION_MAX; percent++) {
    await new Promise((resolve) => setImmediate(resolve));
    const { remembered, minutes } = simulate(model, inputs, percent / 100, cards);
    const score = minutes > 0 ? remembered / minutes : 0;
    if (score > bestScore) {
      best = percent;
      bestScore = score;
    }
  }
  return best;
}
