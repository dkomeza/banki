import { randomUUID } from "node:crypto";
import {
  DECK_TUNING_MIN_REVIEWS,
  type DeckTuningStatus,
  TUNING_REVIEW_INTERVAL,
  type TuneResponse,
  type TuningResult,
  type TuningStatus,
  type TuningTrigger,
} from "@banki/shared";
import { getLogger } from "@logtape/logtape";
import { type SQL, and, asc, count, desc, eq, gte, isNotNull, isNull, or, sql } from "drizzle-orm";
import type { Queryable } from "../db/database";
import { deck, parameter_tuning, progress_reset, review, user_settings } from "../db/schema";
import { DEFAULT_PARAMETERS } from "../scheduling/fsrs";
import {
  type RetentionInputs,
  recommendedRetention as simulateRecommendedRetention,
  retentionInputs,
} from "../scheduling/retention";
import { type Optimizer, libraryOptimizer, trainingItems, tune } from "../scheduling/tuning";
import { clearDeckParameters, decksWithOwnParameters, replayCards } from "./replay";
import { deckSchedulingOf, schedulingSettingsOf } from "./reviews";

const logger = getLogger(["banki", "tuning"]);

// Tuning (CONTEXT.md, ADR-0029): the User's Parameters fitted to their own
// Reviews, overall and then per Deck (ADR-0033), and Reset to defaults, with
// the Tuning log recording each and the Recommended retention worked out
// after each Tuning (ADR-0032).

export type TuningRepository = ReturnType<typeof createTuningRepository>;

/**
 * Applies `parameters` (null for FSRS-6's defaults, or for the overall ones on
 * a Deck) to the User (ADR-0029, ADR-0033): stores them as the overall ones,
 * or as Deck `deckId`'s own, then replays every Card they now apply to
 * (`replayCards`): the Cards of every Deck that follows the overall ones, or
 * Deck `deckId`'s, live and deleted. Expects to run inside the immediate
 * transaction that logs it.
 */
export function applyParameters(
  db: Queryable,
  userId: string,
  parameters: number[] | null,
  deckId?: string,
): void {
  if (deckId === undefined) {
    db.insert(user_settings)
      .values({ userId, fsrsParameters: parameters })
      .onConflictDoUpdate({ target: user_settings.userId, set: { fsrsParameters: parameters } })
      .run();
    replayCards(db, userId, "overall");
  } else {
    db.update(deck)
      .set({ fsrsParameters: parameters })
      .where(and(eq(deck.userId, userId), eq(deck.id, deckId)))
      .run();
    replayCards(db, userId, { deckId });
  }
}

/**
 * Records an automatic Tuning of the User's that applied `parameters` at
 * `ranAt`, from the Reviews they have, its log losses unmeasured, with
 * `recommendedRetention` as its Recommended retention: of the overall
 * Parameters, or of Deck `deckId`'s own, from its Reviews. For the Seed data,
 * which shows the tuned state. `id` is the log row's.
 */
export function writeAppliedTuning(
  db: Queryable,
  userId: string,
  parameters: number[],
  {
    ranAt,
    id,
    recommendedRetention,
    deckId,
  }: { ranAt: Date; id: string; recommendedRetention: number; deckId?: string },
): void {
  applyParameters(db, userId, parameters, deckId);
  db.insert(parameter_tuning)
    .values({
      id,
      userId,
      ranAt,
      trigger: "automatic",
      reviewCount: reviewCountOf(db, userId, deckId),
      outcome: "applied",
      parameters,
      recommendedRetention,
      deckId: deckId ?? null,
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

/** Only the User's Reviews, or only those now in their Deck `deckId` (ADR-0021). */
const reviewsIn = (userId: string, deckId: string | undefined) =>
  deckId === undefined
    ? eq(review.userId, userId)
    : and(eq(review.userId, userId), eq(review.deckId, deckId));

/**
 * How many Reviews the User has, of Cards that are gone too; or how many
 * their Deck `deckId` has, the Reviews that now carry it.
 */
const reviewCountOf = (db: Queryable, userId: string, deckId?: string): number =>
  db.select({ n: count() }).from(review).where(reviewsIn(userId, deckId)).get()?.n ?? 0;

/** The User's overall Tuning log rows, with no Deck (ADR-0033). */
const overallRows = (userId: string) =>
  and(eq(parameter_tuning.userId, userId), isNull(parameter_tuning.deckId));

/**
 * The User's newest overall Tuning log row: the last written, as clocks can
 * tie or step back.
 */
const newestRowOf = (db: Queryable, userId: string) =>
  db
    .select()
    .from(parameter_tuning)
    .where(overallRows(userId))
    .orderBy(desc(sql`rowid`))
    .limit(1)
    .get();

/**
 * What the Recommended retention is worked out from: all the User's Reviews,
 * of every kind and of Cards that are gone too (ADR-0018), or those now in
 * their Deck `deckId`, each with whether its Card was New.
 */
const ratedReviewsOf = (db: Queryable, userId: string, deckId?: string) =>
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
    .where(reviewsIn(userId, deckId))
    .all()
    .map((one) => ({ ...one, wasNew: Boolean(one.wasNew) }));

/** What Tuning learns from: the User's Reviews, or their Deck `deckId`'s (`trainingItems`). */
const trainingItemsOf = (db: Queryable, userId: string, deckId?: string) =>
  trainingItems(
    db
      .select({
        cardId: review.cardId,
        seq: review.seq,
        reviewedAt: review.reviewedAt,
        rating: review.rating,
      })
      .from(review)
      .where(reviewsIn(userId, deckId))
      .all(),
    db
      .select({ cardId: progress_reset.cardId, seq: progress_reset.seq })
      .from(progress_reset)
      .where(eq(progress_reset.userId, userId))
      .all(),
    schedulingSettingsOf(db, userId).studyDay,
  );

/** Works out a Recommended retention; `recommendedRetention` unless a test stubs it. */
export type Recommender = (parameters: number[], inputs: RetentionInputs) => Promise<number>;

/** The User's stored overall Parameters; null while FSRS-6's defaults are in use. */
const storedParametersOf = (db: Queryable, userId: string): number[] | null =>
  db
    .select({ parameters: user_settings.fsrsParameters })
    .from(user_settings)
    .where(eq(user_settings.userId, userId))
    .get()?.parameters ?? null;

/** The User's Deck `deckId`'s own Parameters; null while it follows the overall ones. */
const ownParametersOf = (db: Queryable, userId: string, deckId: string): number[] | null =>
  db
    .select({ parameters: deck.fsrsParameters })
    .from(deck)
    .where(and(eq(deck.userId, userId), eq(deck.id, deckId)))
    .get()?.parameters ?? null;

/**
 * The User's live Decks that a Tuning fits next (ADR-0033): those with
 * `DECK_TUNING_MIN_REVIEWS` Reviews or more, oldest first, each with its count.
 */
const decksToTune = (db: Queryable, userId: string) =>
  db
    .select({ deckId: deck.id, reviewCount: count(review.id) })
    .from(deck)
    .innerJoin(review, and(eq(review.userId, userId), eq(review.deckId, deck.id)))
    .where(and(eq(deck.userId, userId), isNull(deck.deletedAt)))
    .groupBy(deck.id)
    .having(gte(count(review.id), DECK_TUNING_MIN_REVIEWS))
    // Then in the order they were written, as clocks can tie.
    .orderBy(asc(deck.createdAt), asc(sql`${deck}.rowid`))
    .all();

/**
 * Whether an automatic Tuning is due for the User: their Review count is
 * `TUNING_REVIEW_INTERVAL` or more above the newest overall Tuning log row's
 * (0 with none), and automatic Tuning isn't paused: that row isn't a Reset.
 */
function automaticDue(db: Queryable, userId: string): boolean {
  const newest = newestRowOf(db, userId);
  if (newest?.outcome === "reset") return false;
  return reviewCountOf(db, userId) >= (newest?.reviewCount ?? 0) + TUNING_REVIEW_INTERVAL;
}

/**
 * Tuning the User's Parameters, overall and per Deck (ADR-0033). Every query
 * is scoped by the User (ADR-0001). Tune now, automatic Tuning and Reset to
 * defaults run one at a time per User, in this process; a Rating never waits
 * for them. `optimizer` and `recommend` are for tests.
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
   * is written, and stores it on the row, while tuned Parameters are in use:
   * the overall ones, or Deck `deckId`'s own, from its Reviews. While the
   * defaults are, or the Deck follows the overall ones, there is none. A
   * failure is logged and leaves the row's null.
   */
  async function recommendAfter(userId: string, rowId: string, deckId?: string): Promise<void> {
    try {
      const parameters =
        deckId === undefined ? storedParametersOf(db, userId) : ownParametersOf(db, userId, deckId);
      if (parameters === null) return;
      const { studyDay } = schedulingSettingsOf(db, userId);
      const percent = await recommend(
        parameters,
        retentionInputs(ratedReviewsOf(db, userId, deckId), studyDay),
      );
      db.update(parameter_tuning)
        .set({ recommendedRetention: percent })
        .where(and(eq(parameter_tuning.userId, userId), eq(parameter_tuning.id, rowId)))
        .run();
      logger.info("Recommended retention: {percent}%", { percent, deckId });
    } catch (error) {
      logger.error("Working out the Recommended retention failed: {error}", { error, deckId });
    }
  }

  /**
   * Fits new Parameters to the Reviews of the User's Deck `deckId`, which has
   * `reviewCount`, and applies them if they predict its Reviews better than
   * the Parameters it uses now: its own, or the overall ones as this Tuning
   * left them. Logs the attempt as a row of the Deck's, whatever its result,
   * then, after an applied or kept one, works out the Deck's Recommended
   * retention while it has its own Parameters. Never throws.
   */
  async function tuneDeck(
    userId: string,
    deckId: string,
    reviewCount: number,
    trigger: Exclude<TuningTrigger, "reset">,
    now: () => Date,
  ): Promise<void> {
    let result: TuningResult;
    let rowId: string;
    try {
      const items = trainingItemsOf(db, userId, deckId);
      const tuned = await tune(items, deckSchedulingOf(db, userId, deckId).parameters, optimizer);
      const ranAt = now();
      const row = { ranAt, trigger, reviewCount, deckId };
      if (tuned.result === "not_enough_data") {
        rowId = log(userId, { ...row, outcome: "not_enough_data" });
      } else {
        const { result: outcome, ...measured } = tuned;
        rowId = db.transaction(
          (tx) => {
            if (outcome === "applied") applyParameters(tx, userId, measured.parameters, deckId);
            return log(userId, { ...row, outcome, ...measured }, tx);
          },
          { behavior: "immediate" },
        );
      }
      logger.info("Tuning {trigger} of a Deck: {result} from {reviewCount} Reviews", {
        trigger,
        result: tuned.result,
        reviewCount,
        deckId,
      });
      result = tuned.result;
    } catch (error) {
      logger.error("Tuning {trigger} of a Deck failed: {error}", { trigger, error, deckId });
      try {
        log(userId, { ranAt: now(), trigger, reviewCount, outcome: "failed", deckId });
      } catch (logError) {
        logger.error("Logging a failed Tuning failed too: {error}", { error: logError, deckId });
      }
      return;
    }
    if (result === "applied" || result === "kept") await recommendAfter(userId, rowId, deckId);
  }

  /**
   * One Tuning: fits new Parameters to all the User's Reviews, applies them if
   * they predict better, and logs the attempt, whatever its result, then
   * works out the Recommended retention for its row (`recommendAfter`). Then
   * each live Deck with enough Reviews of its own, one at a time
   * (`tuneDeck`). Answers the overall step's result. An automatic one that is
   * no longer due when its turn comes runs not at all (null).
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
      const { parameters } = schedulingSettingsOf(db, userId);
      reviewCount = reviewCountOf(db, userId);
      const tuned = await tune(trainingItemsOf(db, userId), parameters, optimizer);
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
    let decks: ReturnType<typeof decksToTune> = [];
    try {
      decks = decksToTune(db, userId);
    } catch (error) {
      logger.error("Finding the Decks to tune failed: {error}", { error });
    }
    for (const { deckId, reviewCount: deckReviews } of decks) {
      await tuneDeck(userId, deckId, deckReviews, trigger, now);
    }
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

  /** The `rowid` of the User's newest Reset to defaults, 0 before any. */
  const newestResetOf = (userId: string): number =>
    db
      .select({ rowid: sql<number>`rowid` })
      .from(parameter_tuning)
      .where(and(overallRows(userId), eq(parameter_tuning.outcome, "reset")))
      .orderBy(desc(sql`rowid`))
      .limit(1)
      .get()?.rowid ?? 0;

  /** When the newest applied row of `rows` ran, and from how many Reviews. */
  const appliedOf = (rows: SQL | undefined) => {
    const applied = db
      .select({ ranAt: parameter_tuning.ranAt, reviewCount: parameter_tuning.reviewCount })
      .from(parameter_tuning)
      .where(and(rows, eq(parameter_tuning.outcome, "applied")))
      .orderBy(desc(sql`rowid`))
      .limit(1)
      .get();
    return applied === undefined
      ? null
      : { at: applied.ranAt.toISOString(), reviews: applied.reviewCount };
  };

  const attemptOf = (row: typeof parameter_tuning.$inferSelect | undefined) =>
    row === undefined
      ? null
      : { at: row.ranAt.toISOString(), trigger: row.trigger, outcome: row.outcome };

  const status = (userId: string): TuningStatus => {
    const stored = storedParametersOf(db, userId);
    const newest = newestRowOf(db, userId);
    const reviewCount = reviewCountOf(db, userId);
    return {
      parameters: stored === null ? "default" : "tuned",
      tuned: stored === null ? null : appliedOf(overallRows(userId)),
      lastAttempt: attemptOf(newest),
      reviewsUntilAutomatic: Math.max(
        0,
        (newest?.reviewCount ?? 0) + TUNING_REVIEW_INTERVAL - reviewCount,
      ),
      paused: newest?.outcome === "reset",
      running: running.has(userId),
      recommendedRetention: stored === null ? null : (newest?.recommendedRetention ?? null),
      ownDecks: decksWithOwnParameters(db, userId),
    };
  };

  return {
    /** How Tuning stands for the User, of the overall Parameters. */
    status,

    /**
     * How Tuning stands for the User's live Deck `deckId` (ADR-0033), or
     * "not_found". Its last attempt is its newest row, or a Reset to defaults
     * written after it. Its Recommended retention while it has its own
     * Parameters is the newest of its rows since the newest Reset that has
     * one; otherwise it is the overall one (`status`).
     */
    deckStatus(userId: string, deckId: string): DeckTuningStatus | "not_found" {
      const found = db
        .select({ parameters: deck.fsrsParameters })
        .from(deck)
        .where(and(eq(deck.userId, userId), eq(deck.id, deckId), isNull(deck.deletedAt)))
        .get();
      if (found === undefined) return "not_found";
      const own = found.parameters !== null;
      const deckRows = and(
        eq(parameter_tuning.userId, userId),
        eq(parameter_tuning.deckId, deckId),
      );
      const resetSince = newestResetOf(userId);
      const newest = db
        .select()
        .from(parameter_tuning)
        .where(or(deckRows, and(overallRows(userId), eq(parameter_tuning.outcome, "reset"))))
        .orderBy(desc(sql`rowid`))
        .limit(1)
        .get();
      const recommended = own
        ? (db
            .select({ percent: parameter_tuning.recommendedRetention })
            .from(parameter_tuning)
            .where(
              and(
                deckRows,
                isNotNull(parameter_tuning.recommendedRetention),
                sql`rowid > ${resetSince}`,
              ),
            )
            .orderBy(desc(sql`rowid`))
            .limit(1)
            .get()?.percent ?? null)
        : status(userId).recommendedRetention;
      return {
        parameters: own ? "own" : "overall",
        tuned: own ? appliedOf(deckRows) : null,
        reviewCount: reviewCountOf(db, userId, deckId),
        threshold: DECK_TUNING_MIN_REVIEWS,
        lastAttempt: attemptOf(newest),
        recommendedRetention: recommended,
      };
    },

    /**
     * Tune now: a Tuning at once, answered with its overall result and the
     * new status once every Deck has been tuned too, its Recommended
     * retention worked out. It applies only an improvement, and its log row
     * ends a pause. During a queued or running Tuning it waits for that one
     * and answers its result. `now` is for tests.
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
     * Reset to defaults: applies FSRS-6's defaults overall and clears every
     * Deck's own Parameters, deleted Decks' too, through one replay of all the
     * User's Cards, logs a `reset` row, which pauses automatic Tuning until
     * Tune now, and answers the new status; "defaults_in_use" while the
     * defaults already are in use and no Deck has its own. It waits for any
     * running Tuning. `now` is for tests.
     */
    reset(
      userId: string,
      now: () => Date = () => new Date(),
    ): Promise<TuningStatus | "defaults_in_use"> {
      return exclusive(userId, () => {
        const done = db.transaction(
          (tx) => {
            if (storedParametersOf(tx, userId) === null && decksWithOwnParameters(tx, userId) === 0)
              return "defaults_in_use" as const;
            tx.insert(user_settings)
              .values({ userId, fsrsParameters: null })
              .onConflictDoUpdate({ target: user_settings.userId, set: { fsrsParameters: null } })
              .run();
            clearDeckParameters(tx, userId);
            replayCards(tx, userId, "all");
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
