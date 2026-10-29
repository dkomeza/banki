import {
  CARD_STATES,
  type CardSchedule,
  type CardState,
  DESIRED_RETENTION_MAX,
  DESIRED_RETENTION_MIN,
  type Rating,
  type StudyDaySettings,
  addStudyDays,
  studyDayBounds,
  studyDayOf,
} from "@banki/shared";
import {
  type Grade,
  Rating as FsrsRating,
  dateChrono,
  defineScheduler,
  schedulerDesiredRetentionMiddleware,
  schedulerFuzzingMiddleware,
  schedulerLearningStepsMiddleware,
  schedulerMaximumIntervalMiddleware,
  schedulerMonotonicIntervalMiddleware,
  schedulerScheduledDaysMiddleware,
  schedulerStatsMiddleware,
} from "ts-fsrs";
import { FSRS6Model, FSRS6_DEFAULT_WEIGHTS } from "ts-fsrs/models/fsrs-6";

// FSRS (ts-fsrs, FSRS-6) schedules every Card from its Reviews: its default
// parameters, its default learning steps (1 min then 10 min; 10 min to
// relearn) and maximum interval (36,500 days), with interval fuzz on. The fuzz
// is seeded by the Card's ID and its Review count, never the clock, so a
// Rating from a given state always gives the same interval.
//
// The definition is the one ts-fsrs's `DefaultScheduler({ version: "FSRS-6" })`
// builds, put together here so it needs no `await` (fsrs.test.ts holds them
// equal).

const definition = defineScheduler({ model: FSRS6Model, chrono: dateChrono }).use(
  schedulerDesiredRetentionMiddleware,
  schedulerFuzzingMiddleware,
  schedulerStatsMiddleware,
  schedulerScheduledDaysMiddleware,
  schedulerLearningStepsMiddleware,
  schedulerMaximumIntervalMiddleware,
  schedulerMonotonicIntervalMiddleware,
);

const LEARNING_STEPS: ["1m", "10m"] = ["1m", "10m"];
const RELEARNING_STEPS: ["10m"] = ["10m"];

/** The scheduler config for a Desired retention, as `DefaultScheduler` makes it for FSRS-6. */
export const schedulerConfig = (desiredRetention: number) => ({
  fractionalDays: false,
  weights: [...FSRS6_DEFAULT_WEIGHTS],
  enableShortTerm: true,
  numRelearningSteps: RELEARNING_STEPS.length,
  desiredRetention: desiredRetention / 100,
  learningSteps: [...LEARNING_STEPS],
  relearningSteps: [...RELEARNING_STEPS],
  allowModelOverride: false,
  enableFuzz: true,
  maximumInterval: 36_500,
});

type Scheduler = ReturnType<typeof definition.create>;
const schedulers = new Map<number, Scheduler>();

/** The scheduler for a Desired retention, a whole percent from 70 to 97. */
function schedulerFor(desiredRetention: number): Scheduler {
  if (
    !Number.isInteger(desiredRetention) ||
    desiredRetention < DESIRED_RETENTION_MIN ||
    desiredRetention > DESIRED_RETENTION_MAX
  ) {
    throw new RangeError(`No Desired retention of ${desiredRetention}%`);
  }
  let scheduler = schedulers.get(desiredRetention);
  if (scheduler === undefined) {
    scheduler = definition.create({ config: schedulerConfig(desiredRetention) });
    schedulers.set(desiredRetention, scheduler);
  }
  return scheduler;
}

/** A Card's memory state, as a Card row stores it and a Review keeps it from before. */
export type MemoryState = {
  state: CardState;
  /** Null while new. */
  dueAt: Date | null;
  stability: number;
  difficulty: number;
  reps: number;
  lapses: number;
  scheduledDays: number;
  learningStep: number;
  lastReviewAt: Date | null;
};

/** A Card's memory state before its first Review. */
export const NEW_MEMORY_STATE: MemoryState = {
  state: "new",
  dueAt: null,
  stability: 0,
  difficulty: 0,
  reps: 0,
  lapses: 0,
  scheduledDays: 0,
  learningStep: 0,
  lastReviewAt: null,
};

const GRADES = {
  again: FsrsRating.Again,
  hard: FsrsRating.Hard,
  good: FsrsRating.Good,
  easy: FsrsRating.Easy,
} as const satisfies Record<Rating, Grade>;

/** ts-fsrs's number for where a Card is: the same order as `CARD_STATES`. */
const FSRS_STATES = { new: 0, learning: 1, review: 2, relearning: 3 } as const satisfies Record<
  CardState,
  number
>;

/** ts-fsrs's name for where a Card is, which counts relearning as learning. */
const SCHEDULE_STATUSES = {
  new: "new",
  learning: "learning",
  review: "review",
  relearning: "learning",
} as const satisfies Record<CardState, string>;

/** ts-fsrs's card for a Card's memory state. */
const fsrsCard = (cardId: string, memory: MemoryState, now: Date) => ({
  cardId,
  state: FSRS_STATES[memory.state],
  scheduleStatus: SCHEDULE_STATUSES[memory.state],
  // ts-fsrs keeps a new Card due from its creation; it only tells new from not.
  dueAt: memory.dueAt ?? now,
  stability: memory.stability,
  difficulty: memory.difficulty,
  reps: memory.reps,
  lapses: memory.lapses,
  scheduledDays: memory.scheduledDays,
  learningStep: memory.learningStep,
  lastReviewAt: memory.lastReviewAt,
});

/**
 * When a Card scheduled `scheduledDays` (1 or more) days out at `reviewedAt` is
 * due: from the Day start of the Study day that many days after the Review's
 * (ADR-0024).
 */
export function dueOnStudyDay(
  reviewedAt: Date,
  scheduledDays: number,
  studyDay: StudyDaySettings,
): Date {
  const day = addStudyDays(studyDayOf(reviewedAt, studyDay), scheduledDays);
  return studyDayBounds(day, studyDay).start;
}

/**
 * The memory state a Rating at `now` leaves a Card in, at a Desired retention.
 * Past its learning steps it is due on a Study day (`dueOnStudyDay`); in them,
 * at the exact moment its step ends.
 */
export function rate(
  cardId: string,
  before: MemoryState,
  rating: Rating,
  {
    now,
    desiredRetention,
    studyDay,
  }: { now: Date; desiredRetention: number; studyDay: StudyDaySettings },
): MemoryState {
  const { card } = schedulerFor(desiredRetention).review({
    card: fsrsCard(cardId, before, now),
    grade: GRADES[rating],
    now,
  });
  const state = CARD_STATES[card.state] ?? "review";
  return {
    state,
    dueAt:
      state === "review" && card.scheduledDays >= 1
        ? dueOnStudyDay(now, card.scheduledDays, studyDay)
        : card.dueAt,
    stability: card.stability,
    difficulty: card.difficulty,
    reps: card.reps,
    lapses: card.lapses,
    scheduledDays: card.scheduledDays,
    learningStep: card.learningStep,
    lastReviewAt: card.lastReviewAt ?? now,
  };
}

/** A Card's last Review: when, its Rating, and the memory state it started from. */
export type LastReview = { reviewedAt: Date; rating: Rating; before: MemoryState };

/**
 * A Card's memory state after its Desired retention changed: its last Review
 * given again at the new retention, so it is due that Review plus the interval
 * for its memory state at the new retention, fuzzed with the same seed; and
 * due `now` if that has already passed. Only a Card past its learning steps
 * moves: a new Card, or one in them, is answered as it is.
 */
export function reschedule(
  cardId: string,
  current: MemoryState,
  last: LastReview,
  {
    now,
    desiredRetention,
    studyDay,
  }: { now: Date; desiredRetention: number; studyDay: StudyDaySettings },
): MemoryState {
  if (current.state !== "review") return current;
  const again = rate(cardId, last.before, last.rating, {
    now: last.reviewedAt,
    desiredRetention,
    studyDay,
  });
  if (again.state !== "review" || again.dueAt === null) return current;
  return {
    ...current,
    scheduledDays: again.scheduledDays,
    dueAt: again.dueAt < now ? now : again.dueAt,
  };
}

/** A Card's schedule, as the API answers it. */
export const scheduleOf = (memory: MemoryState): CardSchedule => ({
  state: memory.state,
  due: memory.dueAt?.toISOString() ?? null,
  stability: memory.stability,
  difficulty: memory.difficulty,
  reps: memory.reps,
  lapses: memory.lapses,
  scheduledDays: memory.scheduledDays,
  lastReview: memory.lastReviewAt?.toISOString() ?? null,
});
