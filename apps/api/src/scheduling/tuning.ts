import type { Rating, StudyDaySettings } from "@banki/shared";
import { studyDayOf } from "@banki/shared";
import {
  FSRSBinding,
  FSRSBindingItem,
  FSRSBindingReview,
  computeParameters,
} from "@open-spaced-repetition/binding";
import type { Parameters } from "./fsrs";

// Tuning (CONTEXT.md): fitting the Parameters to the User's own Reviews with
// FSRS's optimizer (@open-spaced-repetition/binding, fsrs-rs), FSRS-6 with
// short-term memory and one relearning step, as scheduling/fsrs.ts schedules.

/** A Review as Tuning learns from it. */
export type TrainingReview = { cardId: string; seq: number; reviewedAt: Date; rating: Rating };

/** A Review in a training item: its Rating, 1 to 4, and the Study days since the one before. */
export type TrainingStep = { rating: number; deltaT: number };

/** One Review to predict, after the Card's Reviews before it: the history up to it, it last. */
export type TrainingItem = TrainingStep[];

const RATING_NUMBERS = { again: 1, hard: 2, good: 3, easy: 4 } as const satisfies Record<
  Rating,
  number
>;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The whole Study days from `from` to `to` under `studyDay`; 0 within one, and never below. */
function studyDaysBetween(from: Date, to: Date, studyDay: StudyDaySettings): number {
  const days =
    (Date.parse(studyDayOf(to, studyDay)) - Date.parse(studyDayOf(from, studyDay))) / DAY_MS;
  return Math.max(0, Math.round(days));
}

/**
 * The training items Tuning learns from: per Card, its Reviews after its
 * newest Progress reset (ADR-0026), in the Write order (`seq`), each one after
 * its first an item with the Reviews before it, `deltaT` in Study days under
 * `studyDay`. Reviews of every kind and of Cards that are gone count
 * (ADR-0018), so `reviews` is all of the User's. Only a Review a Study day or
 * more after the one before is an item to predict; same-day ones stay in the
 * history of later items. The library refuses items that end on a same-day
 * Review (InvalidInput, once there are enough of them), and aborts the process
 * on one with no Review a day or more apart at all.
 */
export function trainingItems(
  reviews: readonly TrainingReview[],
  resets: readonly { cardId: string; seq: number }[],
  studyDay: StudyDaySettings,
): TrainingItem[] {
  const newestReset = new Map<string, number>();
  for (const { cardId, seq } of resets) {
    newestReset.set(cardId, Math.max(seq, newestReset.get(cardId) ?? seq));
  }
  const byCard = new Map<string, TrainingReview[]>();
  for (const one of reviews) {
    if (one.seq <= (newestReset.get(one.cardId) ?? Number.NEGATIVE_INFINITY)) continue;
    const list = byCard.get(one.cardId);
    if (list === undefined) byCard.set(one.cardId, [one]);
    else list.push(one);
  }

  const items: TrainingItem[] = [];
  for (const list of byCard.values()) {
    list.sort((a, b) => a.seq - b.seq);
    const history: TrainingStep[] = [];
    list.forEach((one, i) => {
      const previous = list[i - 1];
      const deltaT =
        previous === undefined
          ? 0
          : studyDaysBetween(previous.reviewedAt, one.reviewedAt, studyDay);
      history.push({ rating: RATING_NUMBERS[one.rating], deltaT });
      if (deltaT > 0) items.push(history.map((step) => ({ ...step })));
    });
  }
  return items;
}

/** What Tuning fits and measures Parameters with: the library, unless a test stubs it. */
export type Optimizer = {
  computeParameters(items: TrainingItem[]): Promise<number[]>;
  /** The log loss of `parameters` predicting `items`. */
  evaluate(parameters: Parameters, items: TrainingItem[]): number;
};

const toBinding = (items: TrainingItem[]) =>
  items.map(
    (item) =>
      new FSRSBindingItem(item.map(({ rating, deltaT }) => new FSRSBindingReview(rating, deltaT))),
  );

/** FSRS's optimizer, fsrs-rs through @open-spaced-repetition/binding. */
export const libraryOptimizer: Optimizer = {
  computeParameters: (items) =>
    computeParameters(toBinding(items), { enableShortTerm: true, numRelearningSteps: 1 }),
  // Synchronous, and long for many items: never on a Rating's request path.
  evaluate: (parameters, items) =>
    new FSRSBinding([...parameters]).evaluate(toBinding(items)).logLoss,
};

/** How a Tuning that ran to the end came out. */
export type Tuned =
  | { result: "not_enough_data" }
  | {
      result: "applied" | "kept";
      parameters: number[];
      currentLogLoss: number;
      newLogLoss: number;
    };

const isNotEnoughData = (error: unknown) =>
  error instanceof Error && error.message.includes("NotEnoughData");

/**
 * Fits new Parameters to `items` and measures them and the `current` ones on
 * the same items: "applied" when the new ones' log loss is strictly lower,
 * "kept" otherwise. Whether there is enough data is the library's call
 * (NotEnoughData, fitting or measuring); no items at all is not enough. Any
 * other error is thrown, for the caller to log as failed.
 */
export async function tune(
  items: TrainingItem[],
  current: Parameters,
  optimizer: Optimizer,
): Promise<Tuned> {
  if (items.length === 0) return { result: "not_enough_data" };
  try {
    const parameters = await optimizer.computeParameters(items);
    const currentLogLoss = optimizer.evaluate(current, items);
    const newLogLoss = optimizer.evaluate(parameters, items);
    return {
      result: newLogLoss < currentLogLoss ? "applied" : "kept",
      parameters,
      currentLogLoss,
      newLogLoss,
    };
  } catch (error) {
    if (isNotEnoughData(error)) return { result: "not_enough_data" };
    throw error;
  }
}
