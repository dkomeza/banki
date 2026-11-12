import { randomUUID } from "node:crypto";
import {
  TUNING_REVIEW_INTERVAL,
  type TuneResponse,
  type TuningResult,
  type TuningStatus,
  type TuningTrigger,
} from "@banki/shared";
import { getLogger } from "@logtape/logtape";
import { and, asc, count, desc, eq, sql } from "drizzle-orm";
import type { Queryable } from "../db/database";
import { card, parameter_tuning, progress_reset, review, user_settings } from "../db/schema";
import { DEFAULT_PARAMETERS, type MemoryState, NEW_MEMORY_STATE, rate } from "../scheduling/fsrs";
import {
  type RetentionInputs,
  recommendedRetention as simulateRecommendedRetention,
  retentionInputs,
} from "../scheduling/retention";
import { type Optimizer, libraryOptimizer, trainingItems, tune } from "../scheduling/tuning";
import {
  MEMORY_COLUMNS,
  deckRetentionOf,
  fromStored,
  schedulingSettingsOf,
  toStored,
} from "./reviews";

const logger = getLogger(["banki", "tuning"]);

// Tuning (CONTEXT.md, ADR-0029): the User's Parameters fitted to their own
// Reviews, and Reset to defaults, with the Tuning log recording each and the
// Recommended retention worked out after each Tuning (ADR-0032).

export type TuningRepository = ReturnType<typeof createTuningRepository>;

/** The memory state a replay works out again; the due date and Interval stay as they were. */
const replayed = ({ state, stability, difficulty, reps, lapses, learningStep }: MemoryState) => ({
  state,
  stability,
  difficulty,
  reps,
  lapses,
  learningStep,
});

const sameReplayed = (a: MemoryState, b: MemoryState) =>
  a.state === b.state &&
  a.stability === b.stability &&
  a.difficulty === b.difficulty &&
  a.reps === b.reps &&
  a.lapses === b.lapses &&
  a.learningStep === b.learningStep;

/**
 * Applies `parameters` (null for FSRS-6's defaults) to the User (ADR-0029):
 * stores them, then replays every Card of theirs, live or deleted, from New
 * through its Reviews since its newest Progress reset, in the Write order,
 * under them. Each Review's `cardBefore` and the Card get the memory state
 * the replay works out (`replayed`); their due dates and Intervals stay as
 * they were, and so does each Rating's input to the next, so a replay under
 * unchanged Parameters changes nothing. Expects to run inside the immediate
 * transaction that logs it.
 */
export function applyParameters(db: Queryable, userId: string, parameters: number[] | null): void {
  db.insert(user_settings)
    .values({ userId, fsrsParameters: parameters })
    .onConflictDoUpdate({ target: user_settings.userId, set: { fsrsParameters: parameters } })
    .run();

  const settings = schedulingSettingsOf(db, userId);
  const newestReset = new Map(
    db
      .select({ cardId: progress_reset.cardId, seq: sql<number>`max(${progress_reset.seq})` })
      .from(progress_reset)
      .where(eq(progress_reset.userId, userId))
      .groupBy(progress_reset.cardId)
      .all()
      .map(({ cardId, seq }) => [cardId, seq]),
  );
  const reviews = db
    .select({
      id: review.id,
      cardId: review.cardId,
      seq: review.seq,
      reviewedAt: review.reviewedAt,
      rating: review.rating,
      before: review.cardBefore,
    })
    .from(review)
    .where(eq(review.userId, userId))
    .orderBy(asc(review.seq))
    .all();
  const reviewsOf = new Map<string, typeof reviews>();
  for (const one of reviews) {
    if (one.seq <= (newestReset.get(one.cardId) ?? Number.NEGATIVE_INFINITY)) continue;
    const list = reviewsOf.get(one.cardId);
    if (list === undefined) reviewsOf.set(one.cardId, [one]);
    else list.push(one);
  }

  const retentions = new Map<string, number>();
  const retentionOf = (deckId: string) => {
    let retention = retentions.get(deckId);
    if (retention === undefined) {
      retention = deckRetentionOf(db, userId, deckId);
      retentions.set(deckId, retention);
    }
    return retention;
  };

  const cards = db
    .select({ id: card.id, deckId: card.deckId, ...MEMORY_COLUMNS })
    .from(card)
    .where(eq(card.userId, userId))
    .all();
  for (const { id: cardId, deckId, ...current } of cards) {
    const list = reviewsOf.get(cardId);
    if (list === undefined) continue;
    const desiredRetention = retentionOf(deckId);
    let memory = NEW_MEMORY_STATE;
    for (const one of list) {
      const stored = fromStored(one.before);
      const before = { ...stored, ...replayed(memory) };
      if (!sameReplayed(before, stored)) {
        db.update(review)
          .set({ cardBefore: toStored(before) })
          .where(and(eq(review.userId, userId), eq(review.id, one.id)))
          .run();
      }
      memory = rate(cardId, before, one.rating, {
        ...settings,
        now: one.reviewedAt,
        desiredRetention,
      });
    }
    if (!sameReplayed(current, memory)) {
      db.update(card)
        .set(replayed(memory))
        .where(and(eq(card.userId, userId), eq(card.id, cardId)))
        .run();
    }
  }
}

/**
 * Records an automatic Tuning of the User's that applied `parameters` at
 * `ranAt`, from the Reviews they have, its log losses unmeasured, with
 * `recommendedRetention` as its Recommended retention. For the Seed data,
 * which shows the tuned state. `id` is the log row's.
 */
export function writeAppliedTuning(
  db: Queryable,
  userId: string,
  parameters: number[],
  { ranAt, id, recommendedRetention }: { ranAt: Date; id: string; recommendedRetention: number },
): void {
  applyParameters(db, userId, parameters);
  db.insert(parameter_tuning)
    .values({
      id,
      userId,
      ranAt,
      trigger: "automatic",
      reviewCount: reviewCountOf(db, userId),
      outcome: "applied",
      parameters,
      recommendedRetention,
    })
    .run();
}

/** Whether the User has any Tuning log row. */
export function hasTunings(db: Queryable, userId: string): boolean {
  return (
    db
      .select({ id: parameter_tuning.id })
      .from(parameter_tuning)
      .where(eq(parameter_tuning.userId, userId))
      .limit(1)
      .get() !== undefined
  );
}

/** How many Reviews the User has, of Cards that are gone too. */
const reviewCountOf = (db: Queryable, userId: string): number =>
  db.select({ n: count() }).from(review).where(eq(review.userId, userId)).get()?.n ?? 0;

/** The User's newest Tuning log row: the last written, as clocks can tie or step back. */
const newestRowOf = (db: Queryable, userId: string) =>
  db
    .select()
    .from(parameter_tuning)
    .where(eq(parameter_tuning.userId, userId))
    .orderBy(desc(sql`rowid`))
    .limit(1)
    .get();

/**
 * What the Recommended retention is worked out from: all the User's Reviews,
 * of every kind and of Cards that are gone too (ADR-0018), each with whether
 * its Card was New.
 */
const ratedReviewsOf = (db: Queryable, userId: string) =>
  db
    .select({
      cardId: review.cardId,
      seq: review.seq,
      reviewedAt: review.reviewedAt,
      rating: review.rating,
      durationMs: review.durationMs,
      wasNew: sql<number>`json_extract(${review.cardBefore}, '$.state') = 'new'`,
    })
    .from(review)
    .where(eq(review.userId, userId))
    .all()
    .map((one) => ({ ...one, wasNew: Boolean(one.wasNew) }));

/** Works out a Recommended retention; `recommendedRetention` unless a test stubs it. */
export type Recommender = (parameters: number[], inputs: RetentionInputs) => Promise<number>;

/** The User's stored Parameters; null while FSRS-6's defaults are in use. */
const storedParametersOf = (db: Queryable, userId: string): number[] | null =>
  db
    .select({ parameters: user_settings.fsrsParameters })
    .from(user_settings)
    .where(eq(user_settings.userId, userId))
    .get()?.parameters ?? null;

/**
 * Whether an automatic Tuning is due for the User: their Review count is
 * `TUNING_REVIEW_INTERVAL` or more above the newest Tuning log row's (0 with
 * none), and automatic Tuning isn't paused: the newest row isn't a Reset.
 */
function automaticDue(db: Queryable, userId: string): boolean {
  const newest = newestRowOf(db, userId);
  if (newest?.outcome === "reset") return false;
  return reviewCountOf(db, userId) >= (newest?.reviewCount ?? 0) + TUNING_REVIEW_INTERVAL;
}

/**
 * Tuning the User's Parameters. Every query is scoped by the User (ADR-0001).
 * Tune now, automatic Tuning and Reset to defaults run one at a time per User,
 * in this process; a Rating never waits for them. `optimizer` and `recommend`
 * are for tests.
 */
export function createTuningRepository(
  db: Queryable,
  {
    optimizer = libraryOptimizer,
    recommend = simulateRecommendedRetention,
  }: { optimizer?: Optimizer; recommend?: Recommender } = {},
) {
  /** Each User's last queued operation, which the next one waits for. */
  const queues = new Map<string, Promise<unknown>>();
  /** Each User's queued or running Tuning, which Tune now answers rather than starting another. */
  const running = new Map<string, Promise<TuningResult | null>>();

  const exclusive = <T>(userId: string, work: () => T | Promise<T>): Promise<T> => {
    const done = (queues.get(userId) ?? Promise.resolve()).then(work);
    const settled = done.then(
      () => undefined,
      () => undefined,
    );
    queues.set(userId, settled);
    void settled.then(() => {
      if (queues.get(userId) === settled) queues.delete(userId);
    });
    return done;
  };

  const log = (
    userId: string,
    row: Omit<typeof parameter_tuning.$inferInsert, "id" | "userId">,
    on: Queryable = db,
  ): string => {
    const id = randomUUID();
    on.insert(parameter_tuning)
      .values({ id, userId, ...row })
      .run();
    return id;
  };

  /**
   * Works out the Recommended retention right after the Tuning log row `rowId`
   * is written, and stores it on the row, while tuned Parameters are in use;
   * while the defaults are, there is none. A failure is logged and leaves the
   * row's null.
   */
  async function recommendAfter(userId: string, rowId: string): Promise<void> {
    try {
      const parameters = storedParametersOf(db, userId);
      if (parameters === null) return;
      const { studyDay } = schedulingSettingsOf(db, userId);
      const percent = await recommend(
        parameters,
        retentionInputs(ratedReviewsOf(db, userId), studyDay),
      );
      db.update(parameter_tuning)
        .set({ recommendedRetention: percent })
        .where(and(eq(parameter_tuning.userId, userId), eq(parameter_tuning.id, rowId)))
        .run();
      logger.info("Recommended retention: {percent}%", { percent });
    } catch (error) {
      logger.error("Working out the Recommended retention failed: {error}", { error });
    }
  }

  /**
   * One Tuning: fits new Parameters to all the User's Reviews, applies them if
   * they predict better, and logs the attempt, whatever its result, then
   * works out the Recommended retention for its row (`recommendAfter`). An
   * automatic one that is no longer due when its turn comes runs not at all
   * (null).
   */
  async function runTuning(
    userId: string,
    trigger: Exclude<TuningTrigger, "reset">,
    now: () => Date,
  ): Promise<TuningResult | null> {
    let reviewCount = 0;
    let result: TuningResult;
    let rowId: string;
    try {
      if (trigger === "automatic" && !automaticDue(db, userId)) return null;
      const { studyDay, parameters } = schedulingSettingsOf(db, userId);
      reviewCount = reviewCountOf(db, userId);
      const items = trainingItems(
        db
          .select({
            cardId: review.cardId,
            seq: review.seq,
            reviewedAt: review.reviewedAt,
            rating: review.rating,
          })
          .from(review)
          .where(eq(review.userId, userId))
          .all(),
        db
          .select({ cardId: progress_reset.cardId, seq: progress_reset.seq })
          .from(progress_reset)
          .where(eq(progress_reset.userId, userId))
          .all(),
        studyDay,
      );
      const tuned = await tune(items, parameters, optimizer);
      const ranAt = now();
      if (tuned.result === "not_enough_data") {
        rowId = log(userId, { ranAt, trigger, reviewCount, outcome: "not_enough_data" });
      } else {
        const { result: outcome, ...measured } = tuned;
        rowId = db.transaction(
          (tx) => {
            if (outcome === "applied") applyParameters(tx, userId, measured.parameters);
            return log(userId, { ranAt, trigger, reviewCount, outcome, ...measured }, tx);
          },
          { behavior: "immediate" },
        );
      }
      logger.info("Tuning {trigger}: {result} from {reviewCount} Reviews", {
        trigger,
        result: tuned.result,
        reviewCount,
      });
      result = tuned.result;
    } catch (error) {
      logger.error("Tuning {trigger} failed: {error}", { trigger, error });
      result = "failed";
      try {
        rowId = log(userId, { ranAt: now(), trigger, reviewCount, outcome: "failed" });
      } catch (logError) {
        // Never rejects: an automatic Tuning's promise has no one to catch it.
        logger.error("Logging a failed Tuning failed too: {error}", { error: logError });
        return result;
      }
    }
    await recommendAfter(userId, rowId);
    return result;
  }

  const startTuning = (
    userId: string,
    trigger: Exclude<TuningTrigger, "reset">,
    now: () => Date,
  ): Promise<TuningResult | null> => {
    const queued = running.get(userId);
    if (queued !== undefined) return queued;
    const started = exclusive(userId, () => runTuning(userId, trigger, now)).finally(() => {
      if (running.get(userId) === started) running.delete(userId);
    });
    running.set(userId, started);
    return started;
  };

  const status = (userId: string): TuningStatus => {
    const stored = storedParametersOf(db, userId);
    const newest = newestRowOf(db, userId);
    const applied =
      stored === null
        ? undefined
        : db
            .select({ ranAt: parameter_tuning.ranAt, reviewCount: parameter_tuning.reviewCount })
            .from(parameter_tuning)
            .where(
              and(eq(parameter_tuning.userId, userId), eq(parameter_tuning.outcome, "applied")),
            )
            .orderBy(desc(sql`rowid`))
            .limit(1)
            .get();
    const reviewCount = reviewCountOf(db, userId);
    return {
      parameters: stored === null ? "default" : "tuned",
      tuned:
        applied === undefined
          ? null
          : { at: applied.ranAt.toISOString(), reviews: applied.reviewCount },
      lastAttempt:
        newest === undefined
          ? null
          : { at: newest.ranAt.toISOString(), trigger: newest.trigger, outcome: newest.outcome },
      reviewsUntilAutomatic: Math.max(
        0,
        (newest?.reviewCount ?? 0) + TUNING_REVIEW_INTERVAL - reviewCount,
      ),
      paused: newest?.outcome === "reset",
      running: running.has(userId),
      recommendedRetention: stored === null ? null : (newest?.recommendedRetention ?? null),
    };
  };

  return {
    /** How Tuning stands for the User. */
    status,

    /**
     * Tune now: a Tuning at once, answered with its result and the new
     * status, its Recommended retention worked out. It applies only an improvement, and its log row ends a pause.
     * During a queued or running Tuning it waits for that one and answers its
     * result. `now` is for tests.
     */
    async tuneNow(userId: string, now: () => Date = () => new Date()): Promise<TuneResponse> {
      const queued = running.get(userId);
      const theirs = queued === undefined ? null : await queued;
      const result = theirs ?? (await startTuning(userId, "manual", now)) ?? "failed";
      return { result, status: status(userId) };
    },

    /**
     * After one of the User's Ratings has committed: starts an automatic
     * Tuning in the background when one is due (`automaticDue`), on a later
     * turn of the event loop, so the Rating's answer never waits for it.
     * Answers the Tuning's result once it has run, for tests; undefined when
     * none was due.
     */
    afterRating(
      userId: string,
      now: () => Date = () => new Date(),
    ): Promise<TuningResult | null> | undefined {
      try {
        if (running.has(userId) || !automaticDue(db, userId)) return undefined;
      } catch (error) {
        logger.error("Checking for an automatic Tuning failed: {error}", { error });
        return undefined;
      }
      return new Promise<void>((resolve) => setTimeout(resolve, 0)).then(() =>
        startTuning(userId, "automatic", now),
      );
    },

    /**
     * Reset to defaults: applies FSRS-6's defaults through the same replay,
     * logs a `reset` row, which pauses automatic Tuning until Tune now, and
     * answers the new status; "defaults_in_use" while they already are. It
     * waits for any running Tuning. `now` is for tests.
     */
    reset(
      userId: string,
      now: () => Date = () => new Date(),
    ): Promise<TuningStatus | "defaults_in_use"> {
      return exclusive(userId, () => {
        const done = db.transaction(
          (tx) => {
            if (storedParametersOf(tx, userId) === null) return "defaults_in_use" as const;
            applyParameters(tx, userId, null);
            log(
              userId,
              {
                ranAt: now(),
                trigger: "reset",
                reviewCount: reviewCountOf(tx, userId),
                outcome: "reset",
                parameters: [...DEFAULT_PARAMETERS],
              },
              tx,
            );
            return "reset" as const;
          },
          { behavior: "immediate" },
        );
        if (done === "defaults_in_use") return done;
        logger.info("Parameters reset to the defaults");
        return status(userId);
      });
    },
  };
}
