import {
  DAILY_MINUTES_MAX,
  NEEDED_MINUTES_STEP,
  type PlanCheckResponse,
  REVIEW_CAP_MS,
  type StudyDay,
  type StudyDaySettings,
  addStudyDays,
  studyDayBounds,
  studyDayOf,
} from "@banki/shared";
import { type CardDayAverages, type TimedReview, cardDayAverages } from "./estimate";
import { type MemoryState, NEW_MEMORY_STATE, type Parameters, rate } from "./fsrs";

// The feasibility check (CONTEXT.md: Plan): whether a Daily goal covers a
// Deck's New cards by a Deadline. It simulates each Study day from today to
// the day before the Deadline. Each day's budget is the Daily goal, today's
// what the Deck's Reviews today left of it. Due reviews, and the Cards in
// their learning steps, are paid first at the review rate, and those that
// don't fit carry over to the next day; then as many New cards as fit, at the
// New rate, in the order they were written. Every simulated Review is rated
// Good through the scheduler, so a Card learned now falls due again before
// the Deadline, and a New card graduates on its first day. The New-card batch
// and the Learning limit pace a Session, not a day, so they don't apply.

/** What the check needs to know of a live Card in the Deck. */
export type PlanCheckCard = MemoryState & { id: string; createdAt: Date };

/** One of the User's Reviews, in any Deck. */
export type PlanCheckReview = TimedReview & { deckId: string };

export type PlanCheckInput = {
  deckId: string;
  /** The Deck's live Cards. */
  cards: readonly PlanCheckCard[];
  /** The User's Reviews in every Deck, the last 30 Study days of them at least. */
  reviews: readonly PlanCheckReview[];
  /** The Plan's Deadline: studying for it ends the Study day before. */
  deadline: StudyDay;
  now: Date;
  /** The Deck's Desired retention. */
  desiredRetention: number;
  studyDay: StudyDaySettings;
  parameters: Parameters;
};

const MINUTE_MS = 60_000;
/** How long the check runs at a stretch before it lets the event loop take other work. */
const SLICE_MS = 15;

/**
 * How a check shares the thread: `pause` lets other work run, by default
 * until the event loop's next turn; `signal` stops the check, for one no one
 * waits for any more.
 */
export type CheckOptions = { signal?: AbortSignal; pause?: () => Promise<void> };

const nextTurn = () => new Promise<void>((resolve) => setImmediate(resolve));
/** A Card more than this many Good Ratings in its learning steps is taken as graduated. */
const STEPS_MAX = 10;

const byDueThenId = (a: SimCard, b: SimCard) =>
  (a.memory.dueAt?.getTime() ?? 0) - (b.memory.dueAt?.getTime() ?? 0) ||
  (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

type SimCard = { id: string; memory: MemoryState };

const toSim = (card: PlanCheckCard): SimCard => ({ id: card.id, memory: card });

/**
 * What every Daily goal's run shares: the Study days to simulate, the New
 * cards in the order they were written, the rates and today's spend.
 */
type Simulation = {
  /** Each simulated Study day's start, today's being `now`, and its end. */
  days: { start: Date; end: Date }[];
  fresh: SimCard[];
  others: SimCard[];
  averages: CardDayAverages;
  /** What the Deck's Reviews today took, each counted for at most 2 minutes. */
  spentTodayMs: number;
  input: PlanCheckInput;
  /**
   * Each memory state's Good Rating by when it was given, kept across the
   * runs of one check: they rate the same Cards on mostly the same days. A
   * New card's are under its ID, as every New card starts from the same state.
   */
  rated: Map<MemoryState | string, Map<number, MemoryState>>;
};

function prepare(input: PlanCheckInput): Simulation {
  const { cards, reviews, deadline, now, studyDay, deckId } = input;
  const today = studyDayOf(now, studyDay);
  const days: { start: Date; end: Date }[] = [];
  for (let day = today; day < deadline; day = addStudyDays(day, 1)) {
    const bounds = studyDayBounds(day, studyDay);
    days.push(day === today ? { start: now, end: bounds.end } : bounds);
  }
  const todayStart = studyDayBounds(today, studyDay).start.getTime();
  const spentTodayMs = reviews
    .filter(
      (r) =>
        r.deckId === deckId &&
        r.reviewedAt.getTime() >= todayStart &&
        r.reviewedAt.getTime() <= now.getTime(),
    )
    .reduce((sum, r) => sum + Math.min(Math.max(0, r.durationMs), REVIEW_CAP_MS), 0);
  return {
    days,
    fresh: cards
      .filter((c) => c.state === "new")
      .toSorted(
        (a, b) =>
          a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      )
      .map(toSim),
    others: cards.filter((c) => c.state !== "new").map(toSim),
    averages: cardDayAverages(reviews, { now, studyDay }),
    spentTodayMs,
    input,
    rated: new Map(),
  };
}

/** The index of the simulated day a Card is due on; `days.length` when after them all. */
function dueDayIndex(memory: MemoryState, days: Simulation["days"]): number {
  // A Card in its learning steps is due as soon as it is there.
  if (memory.state !== "review" || memory.dueAt === null) return 0;
  const due = memory.dueAt.getTime();
  let lo = 0;
  let hi = days.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (due < (days[mid]?.end.getTime() ?? Infinity)) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/**
 * How many of the Deck's New cards are never introduced before the Deadline
 * at `dailyMinutes` a day. With `coveredOnly`, only whether that is none
 * counts: the run stops as soon as the New cards left take more than the
 * days left could give them, and answers those left.
 */
async function unlearnedAt(
  sim: Simulation,
  dailyMinutes: number,
  breathe: () => Promise<void>,
  coveredOnly = false,
): Promise<number> {
  const { days, fresh, averages, input } = sim;
  const { reviewMs, newMs } = averages;
  const settings = {
    desiredRetention: input.desiredRetention,
    studyDay: input.studyDay,
    parameters: input.parameters,
  };
  const dueOn: SimCard[][] = days.map(() => []);
  const place = (card: SimCard, after: number) => {
    const index = Math.max(after, dueDayIndex(card.memory, days));
    dueOn[index]?.push(card);
  };
  for (const card of sim.others) place(card, 0);

  /** The Card rated Good at `at`, and again as each learning step ends, until it graduates. */
  const learn = (card: SimCard, at: Date): SimCard => {
    const key = card.memory === NEW_MEMORY_STATE ? card.id : card.memory;
    let byTime = sim.rated.get(key);
    if (byTime === undefined) {
      byTime = new Map();
      sim.rated.set(key, byTime);
    }
    let memory = byTime.get(at.getTime());
    if (memory === undefined) {
      memory = card.memory;
      let now = at;
      for (let step = 0; step < STEPS_MAX; step++) {
        memory = rate(card.id, memory, "good", { ...settings, now });
        if (memory.state === "review" || memory.dueAt === null) break;
        if (memory.dueAt > now) now = memory.dueAt;
      }
      byTime.set(at.getTime(), memory);
    }
    return { id: card.id, memory };
  };

  let introduced = 0;
  let carried: SimCard[] = [];
  for (const [index, { start }] of days.entries()) {
    await breathe();
    let budget = dailyMinutes * MINUTE_MS - (index === 0 ? sim.spentTodayMs : 0);
    const due = [...carried, ...(dueOn[index] ?? [])].toSorted(byDueThenId);
    carried = [];
    for (const [k, card] of due.entries()) {
      if (budget < reviewMs) {
        carried = due.slice(k);
        break;
      }
      budget -= reviewMs;
      const dueAt = card.memory.dueAt;
      place(learn(card, dueAt !== null && dueAt > start ? dueAt : start), index + 1);
    }
    while (introduced < fresh.length && budget >= newMs) {
      const card = fresh[introduced];
      if (card === undefined) break;
      budget -= newMs;
      introduced += 1;
      place(learn({ id: card.id, memory: NEW_MEMORY_STATE }, start), index + 1);
    }
    if (introduced === fresh.length) return 0;
    const daysLeft = days.length - index - 1;
    if (coveredOnly && (fresh.length - introduced) * newMs > daysLeft * dailyMinutes * MINUTE_MS) {
      return fresh.length - introduced;
    }
  }
  return fresh.length - introduced;
}

/**
 * The feasibility check of a Plan of `dailyMinutes` a day for `input`'s
 * Deadline: the Deck's live New cards, how many of them are never introduced
 * before the Deadline, and the smallest Daily goal, a multiple of 5 up to 600,
 * at which none is left (null when even 600 leaves some). Timings are the
 * User's `cardDayAverages`, in every Deck.
 */
export async function checkPlan(
  input: PlanCheckInput,
  dailyMinutes: number,
  { signal, pause = nextTurn }: CheckOptions = {},
): Promise<PlanCheckResponse> {
  // A big Deck takes seconds, so the check gives way every so often.
  let ranFrom = performance.now();
  const breathe = async () => {
    signal?.throwIfAborted();
    if (performance.now() - ranFrom < SLICE_MS) return;
    await pause();
    signal?.throwIfAborted();
    ranFrom = performance.now();
  };
  const sim = prepare(input);
  const newCards = sim.fresh.length;
  const unlearned = await unlearnedAt(sim, dailyMinutes, breathe);
  // More minutes introduce as many New cards or more, so the smallest step
  // that covers them is searched for between two bounds: at or below the goal
  // when it covers them, above it when it doesn't, and never below what the
  // New cards alone take, spread over the days. A run to the Deadline takes
  // long on a big Deck, so each run that falls short guesses the next from
  // how many it introduced, as if the minutes needed grew with the cards, at
  // most twice in a row; else the bounds are halved.
  const steps = Math.floor(DAILY_MINUTES_MAX / NEEDED_MINUTES_STEP);
  const guessFrom = (minutes: number, left: number) =>
    Math.ceil((minutes * newCards) / Math.max(1, newCards - left) / NEEDED_MINUTES_STEP);
  const goalStep = Math.ceil(dailyMinutes / NEEDED_MINUTES_STEP);
  if (unlearned > 0 && (await unlearnedAt(sim, steps * NEEDED_MINUTES_STEP, breathe, true)) > 0) {
    return { newCards, unlearned, neededMinutes: null };
  }
  // No day gives more than the goal, so the New cards alone need at least this.
  const freshMinutes = (newCards * sim.averages.newMs) / (Math.max(1, sim.days.length) * MINUTE_MS);
  const floorStep = Math.max(1, Math.floor(freshMinutes / NEEDED_MINUTES_STEP));
  let lo =
    unlearned > 0
      ? Math.max(Math.floor(dailyMinutes / NEEDED_MINUTES_STEP) + 1, floorStep)
      : Math.min(goalStep, floorStep);
  let hi = unlearned > 0 ? steps : goalStep;
  let guess = unlearned > 0 ? guessFrom(dailyMinutes, unlearned) : undefined;
  let guesses = 0;
  while (lo < hi) {
    const probe =
      guess !== undefined && guesses < 2 ? Math.min(Math.max(guess, lo), hi - 1) : (lo + hi) >> 1;
    const left = await unlearnedAt(sim, probe * NEEDED_MINUTES_STEP, breathe, true);
    if (left === 0) {
      hi = probe;
      guess = undefined;
    } else {
      lo = probe + 1;
      guesses = guess === undefined ? 0 : guesses + 1;
      guess = guessFrom(probe * NEEDED_MINUTES_STEP, left);
    }
  }
  return { newCards, unlearned, neededMinutes: lo * NEEDED_MINUTES_STEP };
}
