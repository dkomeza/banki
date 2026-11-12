import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DECK_TUNING_MIN_REVIEWS, type Rating, TUNING_REVIEW_INTERVAL } from "@banki/shared";
import { asc, eq, sql } from "drizzle-orm";
import { type OpenedDatabase, openDatabase } from "../db/database";
import { applyMigrations } from "../db/migrate";
import { card, deck, parameter_tuning, review, user_settings } from "../db/schema";
import {
  DEFAULT_PARAMETERS,
  type MemoryState,
  NEW_MEMORY_STATE,
  previewIntervals,
  rate,
  reschedule,
  restore,
  scheduleOf,
} from "../scheduling/fsrs";
import { DEFAULT_RETENTION_INPUTS, type RetentionInputs } from "../scheduling/retention";
import type { Optimizer, TrainingItem } from "../scheduling/tuning";
import { type CardRepository, createCardRepository } from "./cards";
import { type DeckRepository, createDeckRepository } from "./decks";
import { createDeletionRepository } from "./deletions";
import { resetProgress } from "./progress-resets";
import {
  MEMORY_COLUMNS,
  type ReviewRepository,
  createReviewRepository,
  fromStored,
  lastReviewOf,
  schedulingSettingsOf,
  toStored,
} from "./reviews";
import { type StudyRepository, createStudyRepository } from "./study";
import {
  type Recommender,
  type TuningRepository,
  applyParameters,
  createTuningRepository,
} from "./tuning";
import { createUserRepository } from "./user";
import { nextSeq } from "./write-order";

let tempDir: string;
let opened: OpenedDatabase;
let cards: CardRepository;
let decks: DeckRepository;
let reviews: ReviewRepository;
let study: StudyRepository;
let tuning: TuningRepository;
let optimizer: StubOptimizer;
let recommender: StubRecommender;
/** What the last Rating's `afterRating` answered. */
let automatic: Promise<unknown> | undefined;

const USER = "user-1";
const OTHER = "user-2";
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const START = new Date("2026-05-01T10:00:00Z");
const later = (ms: number) => new Date(START.getTime() + ms);
const NOW = () => later(400 * DAY);

/** Parameters a Tuning might produce: FSRS-6's defaults, with new Cards' stability much changed. */
const TUNED = DEFAULT_PARAMETERS.map((weight, i) => [2, 3, 0.6, 60][i] ?? weight);

/** An optimizer that answers what a test sets, and records what it was asked. */
type StubOptimizer = Optimizer & {
  produces: number[];
  /** What each fit produces in turn, or throws, before it falls back to `produces` and `fails`. */
  sequence: (number[] | Error)[];
  /** What it fitted last, which predicts with `losses.next`; everything else with `losses.current`. */
  last: number[] | undefined;
  /** The Parameters it measured, in order. */
  evaluated: number[][];
  losses: { current: number; next: number };
  fails: Error | undefined;
  /** Until it settles, fitting waits. */
  gate: Promise<void>;
  fitted: TrainingItem[][];
};

const stubOptimizer = (): StubOptimizer => {
  const stub: StubOptimizer = {
    produces: TUNED,
    sequence: [],
    last: undefined,
    evaluated: [],
    losses: { current: 0.5, next: 0.4 },
    fails: undefined,
    gate: Promise.resolve(),
    fitted: [],
    async computeParameters(items) {
      stub.fitted.push(items);
      await stub.gate;
      const next = stub.sequence.shift();
      if (next instanceof Error) throw next;
      if (next === undefined && stub.fails !== undefined) throw stub.fails;
      stub.last = next ?? stub.produces;
      return stub.last;
    },
    evaluate: (parameters) => {
      stub.evaluated.push([...parameters]);
      return parameters === stub.last ? stub.losses.next : stub.losses.current;
    },
  };
  return stub;
};

/** A Recommended retention worker that answers what a test sets, and records what it was asked. */
type StubRecommender = {
  recommend: Recommender;
  answers: number;
  fails: Error | undefined;
  /** Until it settles, working it out waits. */
  gate: Promise<void>;
  asked: { parameters: number[]; inputs: RetentionInputs }[];
};

const stubRecommender = (): StubRecommender => {
  const stub: StubRecommender = {
    answers: 84,
    fails: undefined,
    gate: Promise.resolve(),
    asked: [],
    async recommend(parameters, inputs) {
      stub.asked.push({ parameters, inputs });
      await stub.gate;
      if (stub.fails !== undefined) throw stub.fails;
      return stub.answers;
    },
  };
  return stub;
};

const gate = () => {
  const { promise: closed, resolve: open } = Promise.withResolvers<void>();
  return { closed, open };
};

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "banki-tuning-"));
  opened = openDatabase(tempDir);
  applyMigrations(opened.db);
  createUserRepository(opened.db).createWithPassword({
    userId: USER,
    accountId: "a1",
    email: "u@x.y",
    passwordHash: "h",
  });
  opened.db.run(
    sql`INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (${OTHER}, 'n', 'o@x.y', 1, 0, 0)`,
  );
  optimizer = stubOptimizer();
  recommender = stubRecommender();
  tuning = createTuningRepository(opened.db, { optimizer, recommend: recommender.recommend });
  automatic = undefined;
  cards = createCardRepository(opened.db);
  decks = createDeckRepository(opened.db);
  reviews = createReviewRepository(opened.db, {
    onRated: (userId) => {
      automatic = tuning.afterRating(userId, NOW);
    },
  });
  study = createStudyRepository(opened.db);
});

afterEach(async () => {
  // A Tuning a test's Ratings started runs to its end before the database closes.
  await automatic;
  opened.close();
  rmSync(tempDir, { recursive: true, force: true });
});

const deckNamed = (name: string, userId = USER) => {
  const created = decks.create(userId, { name, description: null, folderId: null });
  if (typeof created === "string") throw new Error(`${name}: ${created}`);
  return created.id;
};

const write = (deckId: string, front: string, userId = USER) => {
  const created = cards.create(userId, deckId, { front, back: "back" }, { now: START });
  if (typeof created === "string") throw new Error(`${front}: ${created}`);
  return created.id;
};

const memoryOf = (cardId: string): MemoryState => {
  const row = opened.db.select(MEMORY_COLUMNS).from(card).where(eq(card.id, cardId)).get();
  if (row === undefined) throw new Error(`No Card ${cardId}`);
  return row;
};

/** Rates the User's Card through `ratings`, each at the Card's due moment (or `from`), and answers when the last was. */
const rateThrough = (cardId: string, ratings: readonly Rating[], from = START, userId = USER) => {
  let now = from;
  for (const rating of ratings) {
    const due = memoryOf(cardId).dueAt;
    if (due !== null && due > now) now = due;
    const rated = reviews.rate(userId, cardId, { rating, durationMs: 1000 }, { now });
    if (rated === "not_found") throw new Error(`${cardId}: not_found`);
  }
  return now;
};

/** Gives the User `n` more Reviews, of a Card of their own. */
const rateMany = (n: number, userId = USER) => {
  const cardId = write(deckNamed(`Many ${Math.random()}`, userId), "many", userId);
  for (let i = 0; i < n; i += 1) {
    const rated = reviews.rate(
      userId,
      cardId,
      { rating: "good", durationMs: 1000 },
      { now: later(i * DAY) },
    );
    if (rated === "not_found") throw new Error("not_found");
  }
  return cardId;
};

/** Gives the User a Card rated over a few days, something to train on. */
const someHistory = () => rateThrough(write(deckNamed("Spanish"), "uno"), ["good", "good", "good"]);

const logRows = () =>
  opened.db
    .select()
    .from(parameter_tuning)
    .where(eq(parameter_tuning.userId, USER))
    .orderBy(asc(sql`rowid`))
    .all();

const storedParameters = () =>
  opened.db
    .select({ parameters: user_settings.fsrsParameters })
    .from(user_settings)
    .where(eq(user_settings.userId, USER))
    .get()?.parameters ?? null;

const everything = () => ({
  cards: opened.db.select().from(card).orderBy(asc(card.id)).all(),
  reviews: opened.db.select().from(review).orderBy(asc(review.seq)).all(),
});

const apply = (parameters: number[] | null) =>
  opened.db.transaction((tx) => applyParameters(tx, USER, parameters), { behavior: "immediate" });

describe("a Tuning", () => {
  test("applies the new Parameters when their log loss is strictly lower, and logs it", async () => {
    rateThrough(write(deckNamed("Spanish"), "uno"), ["good", "good", "good"]);

    expect(await tuning.tuneNow(USER, NOW)).toMatchObject({
      result: "applied",
      status: {
        parameters: "tuned",
        tuned: { at: NOW().toISOString(), reviews: 3 },
        lastAttempt: { at: NOW().toISOString(), trigger: "manual", outcome: "applied" },
        paused: false,
        running: false,
      },
    });
    expect(storedParameters()).toEqual(TUNED);
    expect(logRows()).toEqual([
      expect.objectContaining({
        ranAt: NOW(),
        trigger: "manual",
        reviewCount: 3,
        outcome: "applied",
        currentLogLoss: 0.5,
        newLogLoss: 0.4,
        parameters: TUNED,
      }),
    ]);
  });

  test("keeps the current Parameters when the new ones are no better, and logs it", async () => {
    someHistory();
    optimizer.losses = { current: 0.5, next: 0.5 };

    expect((await tuning.tuneNow(USER, NOW)).result).toBe("kept");
    expect(storedParameters()).toBeNull();
    expect(logRows()).toEqual([
      expect.objectContaining({
        outcome: "kept",
        currentLogLoss: 0.5,
        newLogLoss: 0.5,
        parameters: TUNED,
      }),
    ]);
  });

  test("is not_enough_data when the library says so, and logs it", async () => {
    someHistory();
    optimizer.fails = new Error("Evaluation failed: NotEnoughData");

    expect((await tuning.tuneNow(USER, NOW)).result).toBe("not_enough_data");
    expect(storedParameters()).toBeNull();
    expect(logRows()).toEqual([
      expect.objectContaining({
        outcome: "not_enough_data",
        currentLogLoss: null,
        newLogLoss: null,
        parameters: null,
      }),
    ]);
  });

  test("is failed when the library throws anything else, and logs it", async () => {
    someHistory();
    optimizer.fails = new Error("boom");

    expect(await tuning.tuneNow(USER, NOW)).toMatchObject({
      result: "failed",
      status: { parameters: "default", lastAttempt: { outcome: "failed" } },
    });
    expect(logRows()).toEqual([
      expect.objectContaining({ outcome: "failed", currentLogLoss: null, parameters: null }),
    ]);
  });

  test("never rejects, even when the failure can't be logged", async () => {
    someHistory();
    const { closed, open } = gate();
    optimizer.gate = closed;
    optimizer.fails = new Error("boom");
    const tuned = tuning.tuneNow(USER, NOW);
    await Bun.sleep(0);
    // The User goes while it runs, so its log row has no User to belong to.
    opened.db.run(sql`DELETE FROM user WHERE id = ${USER}`);

    open();
    expect((await tuned).result).toBe("failed");
    expect(logRows()).toEqual([]);
  });

  test("learns from every Review of the User's, of deleted and Removed Cards too, and only theirs", async () => {
    const deckId = deckNamed("Spanish");
    const live = write(deckId, "uno");
    const deleted = write(deckId, "dos");
    const removed = write(deckId, "tres");
    for (const cardId of [live, deleted, removed]) rateThrough(cardId, ["good", "good", "good"]);
    cards.softDelete(USER, deleted);
    const deletionId = cards.softDelete(USER, removed);
    if (deletionId === undefined) throw new Error("Not deleted");
    createDeletionRepository(opened.db).remove(USER, deletionId);
    rateThrough(
      write(deckNamed("Other", OTHER), "otro", OTHER),
      ["good", "good", "good"],
      START,
      OTHER,
    );

    await tuning.tuneNow(USER, NOW);

    // Each Card's third Review, the first a Study day after the one before.
    expect(optimizer.fitted).toEqual([[...Array(3)].map(() => expect.any(Array))]);
    expect(logRows()[0]?.reviewCount).toBe(9);
  });

  test("a Card's training starts from its newest Progress reset", async () => {
    const cardId = write(deckNamed("Spanish"), "uno");
    const end = rateThrough(cardId, ["good", "good", "good", "good"]);
    opened.db.transaction((tx) => resetProgress(tx, USER, cardId, end));
    rateThrough(cardId, ["hard", "good", "good", "good"], end);

    await tuning.tuneNow(USER, NOW);

    // Only the 4th Review since the reset is a Study day or more after the one before.
    expect(optimizer.fitted).toEqual([
      [[2, 3, 3, 3].map((rating) => expect.objectContaining({ rating }))],
    ]);
  });
});

describe("automatic Tuning", () => {
  test("starts after the Rating that brings the Review count 200 above the newest log row's, without delaying it", async () => {
    rateMany(TUNING_REVIEW_INTERVAL - 1);
    expect(automatic).toBeUndefined();
    expect(tuning.status(USER).reviewsUntilAutomatic).toBe(1);

    rateMany(1);
    expect(automatic).toBeDefined();
    // The Rating has answered, and the Tuning hasn't started yet.
    expect(optimizer.fitted).toHaveLength(0);
    expect(await automatic).toBe("applied");
    expect(logRows()).toEqual([
      expect.objectContaining({ trigger: "automatic", reviewCount: TUNING_REVIEW_INTERVAL }),
    ]);

    // Every log row restarts the count, a failed one too.
    optimizer.fails = new Error("boom");
    rateMany(TUNING_REVIEW_INTERVAL - 1);
    expect(automatic).toBeUndefined();
    rateMany(1);
    expect(await automatic).toBe("failed");
    rateMany(TUNING_REVIEW_INTERVAL - 1);
    expect(automatic).toBeUndefined();
    expect(tuning.status(USER).reviewsUntilAutomatic).toBe(1);
  });

  test("an Undo lowers the Review count", async () => {
    const cardId = rateMany(3);
    expect(tuning.status(USER).reviewsUntilAutomatic).toBe(TUNING_REVIEW_INTERVAL - 3);
    const newest = opened.db
      .select({ id: review.id })
      .from(review)
      .where(eq(review.cardId, cardId))
      .orderBy(sql`${review.seq} DESC`)
      .get();
    expect(study.undo(USER, newest?.id ?? "")).toMatchObject({ card: { id: cardId } });

    expect(tuning.status(USER).reviewsUntilAutomatic).toBe(TUNING_REVIEW_INTERVAL - 2);
  });

  test("none starts while paused by a Reset to defaults, until Tune now resumes it", async () => {
    someHistory();
    await tuning.tuneNow(USER, NOW);
    expect(await tuning.reset(USER, NOW)).toMatchObject({ parameters: "default", paused: true });

    rateMany(TUNING_REVIEW_INTERVAL * 2);
    expect(automatic).toBeUndefined();
    expect(tuning.status(USER)).toMatchObject({ paused: true, reviewsUntilAutomatic: 0 });

    expect((await tuning.tuneNow(USER, NOW)).status.paused).toBe(false);
    rateMany(TUNING_REVIEW_INTERVAL);
    expect(await automatic).toBe("applied");
  });

  test("counts only the User's own Reviews", () => {
    rateMany(TUNING_REVIEW_INTERVAL, OTHER);
    expect(tuning.status(USER).reviewsUntilAutomatic).toBe(TUNING_REVIEW_INTERVAL);
  });
});

describe("one at a time", () => {
  test("Tune now during a running Tuning waits for it and answers its result", async () => {
    someHistory();
    const { closed, open } = gate();
    optimizer.gate = closed;
    const first = tuning.tuneNow(USER, NOW);
    await Bun.sleep(0);
    expect(tuning.status(USER).running).toBe(true);
    const second = tuning.tuneNow(USER, NOW);

    open();
    expect((await first).result).toBe("applied");
    expect((await second).result).toBe("applied");
    expect(optimizer.fitted).toHaveLength(1);
    expect(logRows()).toHaveLength(1);
    expect(tuning.status(USER).running).toBe(false);
  });

  test("Tune now during an automatic Tuning answers the automatic one's result", async () => {
    const { closed, open } = gate();
    optimizer.gate = closed;
    rateMany(TUNING_REVIEW_INTERVAL);
    await Bun.sleep(1);
    expect(tuning.status(USER).running).toBe(true);
    optimizer.losses = { current: 0.5, next: 0.6 };
    const now = tuning.tuneNow(USER, NOW);

    open();
    expect((await now).result).toBe("kept");
    expect(await automatic).toBe("kept");
    expect(logRows().map((row) => row.trigger)).toEqual(["automatic"]);
  });

  test("a Reset waits for a running Tuning, and the Rating never does", async () => {
    const cardId = write(deckNamed("Spanish"), "uno");
    rateThrough(cardId, ["good", "good", "good"]);
    const { closed, open } = gate();
    optimizer.gate = closed;
    const tuned = tuning.tuneNow(USER, NOW);
    let reset: unknown;
    const resetting = tuning.reset(USER, NOW).then((answer) => {
      reset = answer;
    });
    await Bun.sleep(1);
    expect(reset).toBeUndefined();
    expect(reviews.rate(USER, cardId, { rating: "good", durationMs: 1 })).not.toBe("not_found");

    open();
    await Promise.all([tuned, resetting]);
    expect(reset).toMatchObject({ parameters: "default", paused: true });
    expect(logRows().map((row) => row.outcome)).toEqual(["applied", "reset"]);
  });

  test("another User's Tuning doesn't wait for this one's", async () => {
    const { closed, open } = gate();
    optimizer.gate = closed;
    someHistory();
    const mine = tuning.tuneNow(USER, NOW);
    await Bun.sleep(0);
    expect(tuning.status(USER).running).toBe(true);
    expect(tuning.status(OTHER).running).toBe(false);
    open();
    await mine;
  });
});

/** Each Tuning log row's Recommended retention, oldest first. */
const recommended = () => logRows().map((row) => row.recommendedRetention);

describe("the Recommended retention", () => {
  test("is worked out for an applied row under its new Parameters, and Tune now answers it", async () => {
    someHistory();

    expect(await tuning.tuneNow(USER, NOW)).toMatchObject({
      result: "applied",
      status: { parameters: "tuned", recommendedRetention: 84 },
    });
    expect(recommended()).toEqual([84]);
    expect(recommender.asked).toEqual([{ parameters: TUNED, inputs: expect.any(Object) }]);
    expect(tuning.status(USER).recommendedRetention).toBe(84);
  });

  test("is worked out for every row that leaves tuned Parameters in use, whatever its outcome", async () => {
    someHistory();
    apply(TUNED);

    optimizer.losses = { current: 0.5, next: 0.5 };
    recommender.answers = 81;
    expect((await tuning.tuneNow(USER, NOW)).status.recommendedRetention).toBe(81);
    optimizer.fails = new Error("Evaluation failed: NotEnoughData");
    recommender.answers = 82;
    expect((await tuning.tuneNow(USER, NOW)).status.recommendedRetention).toBe(82);
    optimizer.fails = new Error("boom");
    recommender.answers = 83;
    expect((await tuning.tuneNow(USER, NOW)).status.recommendedRetention).toBe(83);

    expect(logRows().map((row) => row.outcome)).toEqual(["kept", "not_enough_data", "failed"]);
    expect(recommended()).toEqual([81, 82, 83]);
    expect(recommender.asked.map((one) => one.parameters)).toEqual([TUNED, TUNED, TUNED]);
  });

  test("is worked out for an automatic row, in the background", async () => {
    rateMany(TUNING_REVIEW_INTERVAL);
    expect(await automatic).toBe("applied");
    expect(logRows()).toEqual([
      expect.objectContaining({ trigger: "automatic", recommendedRetention: 84 }),
    ]);
  });

  test("is none while the defaults are in use", async () => {
    someHistory();
    optimizer.losses = { current: 0.5, next: 0.5 };
    expect((await tuning.tuneNow(USER, NOW)).status.recommendedRetention).toBeNull();
    optimizer.fails = new Error("boom");
    expect((await tuning.tuneNow(USER, NOW)).status.recommendedRetention).toBeNull();

    expect(recommended()).toEqual([null, null]);
    expect(recommender.asked).toEqual([]);
  });

  test("is none after a Reset to defaults, whose row has none", async () => {
    someHistory();
    await tuning.tuneNow(USER, NOW);

    expect(await tuning.reset(USER, NOW)).toMatchObject({ recommendedRetention: null });
    expect(recommended()).toEqual([84, null]);
    expect(recommender.asked).toHaveLength(1);
  });

  test("is the newest row's, so none until the next Tuning on rows from before it", async () => {
    someHistory();
    await tuning.tuneNow(USER, NOW);
    opened.db.update(parameter_tuning).set({ recommendedRetention: null }).run();

    expect(tuning.status(USER)).toMatchObject({ parameters: "tuned", recommendedRetention: null });
  });

  test("a failure is logged and leaves the row's null, and the Tuning stands", async () => {
    someHistory();
    recommender.fails = new Error("boom");

    expect(await tuning.tuneNow(USER, NOW)).toMatchObject({
      result: "applied",
      status: { parameters: "tuned", recommendedRetention: null },
    });
    expect(storedParameters()).toEqual(TUNED);
    expect(logRows()).toEqual([
      expect.objectContaining({ outcome: "applied", recommendedRetention: null }),
    ]);
  });

  test("Tune now waits for it, and a Rating never does", async () => {
    const cardId = write(deckNamed("Spanish"), "uno");
    rateThrough(cardId, ["good", "good", "good"]);
    const { closed, open } = gate();
    recommender.gate = closed;
    let answered: unknown;
    const tuned = tuning.tuneNow(USER, NOW).then((answer) => {
      answered = answer;
    });
    await Bun.sleep(1);
    expect(recommender.asked).toHaveLength(1);
    expect(answered).toBeUndefined();
    expect(reviews.rate(USER, cardId, { rating: "good", durationMs: 1 })).not.toBe("not_found");

    open();
    await tuned;
    expect(answered).toMatchObject({ status: { recommendedRetention: 84 } });
  });

  test("is worked out from every Review of the User's, of deleted and Removed Cards too, and only theirs", async () => {
    const deckId = deckNamed("Spanish");
    const rateOnce = (cardId: string, durationMs: number, userId = USER) => {
      const rated = reviews.rate(userId, cardId, { rating: "good", durationMs }, { now: START });
      if (rated === "not_found") throw new Error("not_found");
    };
    const ids = Array.from({ length: 20 }, (_, i) => write(deckId, `card ${i}`));
    // Each one New card-day, the last two each capped at 2 minutes.
    ids.forEach((cardId, i) => rateOnce(cardId, i < 18 ? 10_000 : 10 * 60_000));
    cards.softDelete(USER, ids[0] ?? "");
    const deletionId = cards.softDelete(USER, ids[1] ?? "");
    if (deletionId === undefined) throw new Error("Not deleted");
    createDeletionRepository(opened.db).remove(USER, deletionId);
    const otherDeck = deckNamed("Other", OTHER);
    for (let i = 0; i < 20; i += 1) rateOnce(write(otherDeck, `otro ${i}`, OTHER), 1, OTHER);
    apply(TUNED);
    optimizer.losses = { current: 0.5, next: 0.5 };

    await tuning.tuneNow(USER, NOW);

    expect(recommender.asked[0]?.inputs).toEqual({
      ...DEFAULT_RETENTION_INPUTS,
      newDayMs: (18 * 10_000 + 2 * 120_000) / 20,
      firstRatings: [0, 0, 1, 0],
    });
  });

  test("is worked out for real, within the 70–97 range", async () => {
    const real = createTuningRepository(opened.db, { optimizer });
    someHistory();

    const percent = (await real.tuneNow(USER, NOW)).status.recommendedRetention;
    expect(percent).toBeGreaterThanOrEqual(70);
    expect(percent).toBeLessThanOrEqual(97);
  });
});

describe("Reset to defaults", () => {
  test("is refused while the defaults are in use", async () => {
    expect(await tuning.reset(USER, NOW)).toBe("defaults_in_use");
    expect(logRows()).toEqual([]);
  });

  test("applies the defaults through the same replay and logs a reset row", async () => {
    const cardId = write(deckNamed("Spanish"), "uno");
    rateThrough(cardId, ["good", "good", "good", "hard"]);
    const before = everything();
    await tuning.tuneNow(USER, NOW);
    expect(everything()).not.toEqual(before);

    expect(await tuning.reset(USER, NOW)).toEqual({
      parameters: "default",
      tuned: null,
      lastAttempt: { at: NOW().toISOString(), trigger: "reset", outcome: "reset" },
      reviewsUntilAutomatic: TUNING_REVIEW_INTERVAL,
      paused: true,
      running: false,
      recommendedRetention: null,
      ownDecks: 0,
    });
    expect(storedParameters()).toBeNull();
    expect(everything()).toEqual(before);
    expect(logRows()[1]).toMatchObject({
      trigger: "reset",
      outcome: "reset",
      reviewCount: 4,
      parameters: [...DEFAULT_PARAMETERS],
    });
  });
});

/** A Deck with a Card rated through a few days, one deleted, one reset partway and one new. */
const histories = () => {
  const deckId = deckNamed("Spanish");
  const live = write(deckId, "uno");
  const deleted = write(deckId, "dos");
  const reset = write(deckId, "tres");
  const fresh = write(deckId, "cuatro");
  rateThrough(live, ["again", "good", "good", "good", "hard", "good"]);
  rateThrough(deleted, ["good", "good", "easy", "again", "good"]);
  const end = rateThrough(reset, ["good", "good", "good"]);
  opened.db.transaction((tx) => resetProgress(tx, USER, reset, end));
  rateThrough(reset, ["good", "good", "good", "good"], end);
  cards.softDelete(USER, deleted);
  return { live, deleted, reset, fresh };
};

describe("applying Parameters", () => {
  test("under unchanged Parameters changes nothing", () => {
    histories();
    const before = everything();

    apply(null);
    expect(everything()).toEqual(before);
    apply([...DEFAULT_PARAMETERS]);
    expect(everything()).toEqual(before);
  });

  test("replays every live and deleted Card, keeping each due date and Interval", () => {
    const { live, deleted, reset, fresh } = histories();
    const before = everything();

    apply(TUNED);

    const after = everything();
    const settings = schedulingSettingsOf(opened.db, USER);
    expect(settings.parameters).toEqual(TUNED);
    for (const cardId of [live, deleted, reset]) {
      const was = before.cards.find((c) => c.id === cardId);
      const now = after.cards.find((c) => c.id === cardId);
      if (was === undefined || now === undefined) throw new Error("missing");
      // The due date, the Interval and the last Review stay; the memory state is new.
      expect(now).toMatchObject({
        dueAt: was.dueAt,
        scheduledDays: was.scheduledDays,
        lastReviewAt: was.lastReviewAt,
      });
      expect(now.stability).not.toBe(was.stability);

      // Each Review's state from before follows from the one before it under the new Parameters,
      // and the Card's from its newest.
      const replayed = after.reviews.filter((r) => r.cardId === cardId);
      const counted = cardId === reset ? replayed.slice(3) : replayed;
      counted.forEach((one, i) => {
        const stored = fromStored(one.cardBefore);
        const kept = fromStored(before.reviews.find((r) => r.id === one.id)?.cardBefore);
        expect(stored).toMatchObject({
          dueAt: kept.dueAt,
          scheduledDays: kept.scheduledDays,
          lastReviewAt: kept.lastReviewAt,
        });
        const next = counted[i + 1];
        const worked = rate(cardId, stored, one.rating, {
          ...settings,
          now: one.reviewedAt,
          desiredRetention: 90,
        });
        const { dueAt: _d, scheduledDays: _s, lastReviewAt: _l, ...memory } = worked;
        expect(next === undefined ? now : fromStored(next.cardBefore)).toMatchObject(memory);
      });
      // Reviews from before a Progress reset keep what they had.
      if (cardId === reset) {
        expect(replayed.slice(0, 3)).toEqual(
          before.reviews.filter((r) => r.cardId === reset).slice(0, 3),
        );
      }
    }
    expect(after.cards.find((c) => c.id === fresh)).toEqual(
      before.cards.find((c) => c.id === fresh),
    );

    // And again under the same Parameters, nothing.
    apply(TUNED);
    expect(everything()).toEqual(after);
  });

  test("leaves another User's Cards and Reviews alone", () => {
    const theirs = write(deckNamed("Theirs", OTHER), "suyo", OTHER);
    rateThrough(theirs, ["good", "good", "good", "hard"], START, OTHER);
    const before = everything();

    apply(TUNED);

    expect(everything()).toEqual(before);
  });

  test("Undo after a Tuning restores the replayed state", async () => {
    const { live } = histories();
    await tuning.tuneNow(USER, NOW);
    const newest = opened.db
      .select({ id: review.id, before: review.cardBefore })
      .from(review)
      .where(eq(review.cardId, live))
      .orderBy(sql`${review.seq} DESC`)
      .get();
    if (newest === undefined) throw new Error("No Review");
    const replayed = fromStored(newest.before);

    study.undo(USER, newest.id, { now: later(60 * DAY) });

    const { dueAt: _d, scheduledDays: _s, ...memory } = replayed;
    expect(memoryOf(live)).toMatchObject(memory);
  });

  test("a tuned set changes the Intervals a Card previews and the order the Queue shows Cards in", () => {
    const deckId = deckNamed("Spanish");
    const easy = write(deckId, "easy");
    const good = write(deckId, "good");
    rateThrough(easy, ["easy"]);
    rateThrough(good, ["good", "good", "good"]);
    const late = { now: later(60 * DAY) };
    const progress = { reviewsShown: 0, newShown: 0, batches: 1 };
    const intervals = study.intervals(USER, easy, late);
    // Under the defaults, a first Easy gives less stability than Good three times.
    expect(study.next(USER, deckId, progress, late)).toMatchObject({
      next: { card: { id: easy } },
    });

    apply(TUNED);

    expect(study.intervals(USER, easy, late)).not.toEqual(intervals);
    expect(study.next(USER, deckId, progress, late)).toMatchObject({
      next: { card: { id: good } },
    });
  });
});

/** Parameters a Deck's own Tuning might produce, unlike `TUNED`. */
const DECK_TUNED = DEFAULT_PARAMETERS.map((weight, i) => [0.5, 1, 9, 30][i] ?? weight);

/**
 * Gives the User's Deck `deckId` `n` Reviews of a Removed Card, one a day
 * from `from`, which count for it and train it (ADR-0018), without a Rating
 * that would start an automatic Tuning.
 */
const pastReviews = (deckId: string, n: number, from = START) => {
  const cardId = `removed-${Math.random()}`;
  opened.db.transaction(
    (tx) => {
      const first = nextSeq(tx, USER);
      for (let i = 0; i < n; i += 1) {
        tx.insert(review)
          .values({
            id: `${cardId}-${i}`,
            userId: USER,
            cardId,
            deckId,
            reviewedAt: new Date(from.getTime() + i * DAY),
            rating: i % 7 === 3 ? "again" : "good",
            kind: "self-rated",
            durationMs: 1000,
            cardBefore: toStored(NEW_MEMORY_STATE),
            seq: first + i,
          })
          .run();
      }
    },
    { behavior: "immediate" },
  );
};

const applyTo = (deckId: string, parameters: number[] | null) =>
  opened.db.transaction((tx) => applyParameters(tx, USER, parameters, deckId), {
    behavior: "immediate",
  });

const ownParameters = (deckId: string) =>
  opened.db.select({ parameters: deck.fsrsParameters }).from(deck).where(eq(deck.id, deckId)).get()
    ?.parameters ?? null;

const deckRows = (deckId: string) => logRows().filter((row) => row.deckId === deckId);

/** Each fit in turn produces the next of `sets`, each better than the Parameters in use. */
const fitsInTurn = (...sets: (number[] | Error)[]) => {
  optimizer.sequence = sets;
};

describe("a Deck's own Tuning", () => {
  test("fits each live Deck with 1,000 Reviews or more after the overall Parameters, one with 999 not at all", async () => {
    const below = deckNamed("Below");
    const at = deckNamed("At");
    pastReviews(below, DECK_TUNING_MIN_REVIEWS - 1);
    pastReviews(at, DECK_TUNING_MIN_REVIEWS);
    fitsInTurn(TUNED, DECK_TUNED);

    expect((await tuning.tuneNow(USER, NOW)).result).toBe("applied");

    expect(optimizer.fitted).toHaveLength(2);
    // The overall ones learn from every Review, the Deck's from its own.
    expect(optimizer.fitted[1]?.length).toBeLessThan(optimizer.fitted[0]?.length ?? 0);
    expect(logRows()).toEqual([
      expect.objectContaining({
        deckId: null,
        outcome: "applied",
        reviewCount: 2 * DECK_TUNING_MIN_REVIEWS - 1,
      }),
      expect.objectContaining({
        deckId: at,
        trigger: "manual",
        outcome: "applied",
        reviewCount: DECK_TUNING_MIN_REVIEWS,
        currentLogLoss: 0.5,
        newLogLoss: 0.4,
        parameters: DECK_TUNED,
      }),
    ]);
    expect(storedParameters()).toEqual(TUNED);
    expect(ownParameters(at)).toEqual(DECK_TUNED);
    expect(ownParameters(below)).toBeNull();
  });

  test("counts a Moved Card's Reviews for its new Deck", async () => {
    const from = deckNamed("From");
    const to = deckNamed("To");
    const moved = write(from, "uno");
    rateThrough(moved, ["good", "good", "good"]);
    pastReviews(to, DECK_TUNING_MIN_REVIEWS - 3, later(30 * DAY));

    await tuning.tuneNow(USER, NOW);
    expect(optimizer.fitted).toHaveLength(1);

    expect(cards.move(USER, [moved], to)).not.toBe("not_found");
    await tuning.tuneNow(USER, NOW);
    expect(optimizer.fitted).toHaveLength(3);
    expect(deckRows(to)).toEqual([
      expect.objectContaining({ reviewCount: DECK_TUNING_MIN_REVIEWS }),
    ]);
    expect(deckRows(from)).toEqual([]);
  });

  test("skips a deleted Deck, which keeps its own Parameters for a Restore", async () => {
    const gone = deckNamed("Gone");
    pastReviews(gone, DECK_TUNING_MIN_REVIEWS);
    applyTo(gone, DECK_TUNED);
    decks.softDelete(USER, gone);

    await tuning.tuneNow(USER, NOW);

    expect(optimizer.fitted).toHaveLength(1);
    expect(deckRows(gone)).toEqual([]);
    expect(ownParameters(gone)).toEqual(DECK_TUNED);
  });

  test("measures a following Deck against the overall Parameters as this Tuning left them, and one with its own against those", async () => {
    const following = deckNamed("Following");
    const owning = deckNamed("Owning");
    pastReviews(following, DECK_TUNING_MIN_REVIEWS);
    pastReviews(owning, DECK_TUNING_MIN_REVIEWS);
    const OWN = DEFAULT_PARAMETERS.map((weight, i) => (i === 0 ? 7 : weight));
    applyTo(owning, OWN);
    const NEXT = DEFAULT_PARAMETERS.map((weight, i) => (i === 0 ? 8 : weight));
    fitsInTurn(TUNED, DECK_TUNED, NEXT);

    await tuning.tuneNow(USER, NOW);

    // Each fit measures the Parameters in use, then its own.
    expect(optimizer.evaluated).toEqual([
      [...DEFAULT_PARAMETERS],
      TUNED,
      TUNED,
      DECK_TUNED,
      OWN,
      NEXT,
    ]);
  });

  test("keeps what the Deck uses unless the new fit's log loss is strictly lower", async () => {
    const following = deckNamed("Following");
    const owning = deckNamed("Owning");
    pastReviews(following, DECK_TUNING_MIN_REVIEWS);
    pastReviews(owning, DECK_TUNING_MIN_REVIEWS);
    applyTo(owning, DECK_TUNED);
    optimizer.losses = { current: 0.5, next: 0.5 };

    expect((await tuning.tuneNow(USER, NOW)).result).toBe("kept");

    expect(logRows().map(({ deckId, outcome }) => ({ deckId, outcome }))).toEqual([
      { deckId: null, outcome: "kept" },
      { deckId: following, outcome: "kept" },
      { deckId: owning, outcome: "kept" },
    ]);
    expect(ownParameters(following)).toBeNull();
    expect(ownParameters(owning)).toEqual(DECK_TUNED);
  });

  test("one Deck failing or without enough data leaves the others, and Tune now answers the overall result", async () => {
    const failing = deckNamed("Failing");
    const thin = deckNamed("Thin");
    const fine = deckNamed("Fine");
    for (const deckId of [failing, thin, fine]) pastReviews(deckId, DECK_TUNING_MIN_REVIEWS);
    fitsInTurn(TUNED, new Error("boom"), new Error("Evaluation failed: NotEnoughData"), DECK_TUNED);

    expect((await tuning.tuneNow(USER, NOW)).result).toBe("applied");

    expect(logRows().map(({ deckId, outcome }) => ({ deckId, outcome }))).toEqual([
      { deckId: null, outcome: "applied" },
      { deckId: failing, outcome: "failed" },
      { deckId: thin, outcome: "not_enough_data" },
      { deckId: fine, outcome: "applied" },
    ]);
    expect(ownParameters(fine)).toEqual(DECK_TUNED);
    expect(ownParameters(failing)).toBeNull();
  });

  test("Decks are tuned after an overall step that failed too", async () => {
    const deckId = deckNamed("Spanish");
    pastReviews(deckId, DECK_TUNING_MIN_REVIEWS);
    fitsInTurn(new Error("boom"), DECK_TUNED);

    expect((await tuning.tuneNow(USER, NOW)).result).toBe("failed");
    expect(ownParameters(deckId)).toEqual(DECK_TUNED);
  });

  test("an automatic Tuning tunes the Decks too", async () => {
    const deckId = deckNamed("Spanish");
    pastReviews(deckId, DECK_TUNING_MIN_REVIEWS);
    fitsInTurn(TUNED, DECK_TUNED);

    rateMany(1);
    expect(await automatic).toBe("applied");
    expect(deckRows(deckId)).toEqual([
      expect.objectContaining({ trigger: "automatic", outcome: "applied" }),
    ]);
  });

  test("Deck rows don't count towards the 200 Reviews, the Reviews until the next one or the pause", async () => {
    const deckId = deckNamed("Spanish");
    pastReviews(deckId, DECK_TUNING_MIN_REVIEWS);
    const other = rateMany(3);

    await tuning.tuneNow(USER, NOW);
    expect(deckRows(deckId)).toEqual([
      expect.objectContaining({ reviewCount: DECK_TUNING_MIN_REVIEWS }),
    ]);
    // From the overall row's 1,003, not the Deck's 1,000.
    expect(tuning.status(USER)).toMatchObject({
      reviewsUntilAutomatic: TUNING_REVIEW_INTERVAL,
      lastAttempt: { outcome: "applied" },
    });
    expect(tuning.afterRating(USER, NOW)).toBeUndefined();

    await tuning.reset(USER, NOW);
    opened.db
      .insert(parameter_tuning)
      .values({
        id: "deck-row",
        userId: USER,
        deckId,
        ranAt: NOW(),
        trigger: "automatic",
        reviewCount: 0,
        outcome: "kept",
      })
      .run();
    expect(tuning.status(USER)).toMatchObject({
      paused: true,
      lastAttempt: { outcome: "reset" },
    });
    rateThrough(other, ["good"], later(500 * DAY));
    expect(automatic).toBeUndefined();
  });
});

describe("a Deck's own Parameters", () => {
  /** Two Decks, each with Cards rated through a few days, one deleted. */
  const twoDecks = () => {
    const own = deckNamed("Own");
    const overall = deckNamed("Overall");
    const ownCards = [write(own, "uno"), write(own, "dos")];
    const overallCards = [write(overall, "eins"), write(overall, "zwei")];
    for (const cardId of [...ownCards, ...overallCards]) {
      rateThrough(cardId, ["again", "good", "good", "hard", "good"]);
    }
    cards.softDelete(USER, ownCards[1] ?? "");
    cards.softDelete(USER, overallCards[1] ?? "");
    return { own, overall, ownCards, overallCards };
  };

  const cardsOf = (ids: readonly string[]) => {
    const all = everything();
    return {
      cards: all.cards.filter((c) => ids.includes(c.id)),
      reviews: all.reviews.filter((r) => ids.includes(r.cardId)),
    };
  };

  test("applying a Deck's replays only its live and deleted Cards, keeping their due dates and Intervals", () => {
    const { own, ownCards, overallCards } = twoDecks();
    const before = everything();

    applyTo(own, DECK_TUNED);

    expect(cardsOf(overallCards)).toEqual({
      cards: before.cards.filter((c) => overallCards.includes(c.id)),
      reviews: before.reviews.filter((r) => overallCards.includes(r.cardId)),
    });
    for (const cardId of ownCards) {
      const was = before.cards.find((c) => c.id === cardId);
      const now = cardsOf([cardId]).cards[0];
      expect(now).toMatchObject({ dueAt: was?.dueAt, scheduledDays: was?.scheduledDays });
      expect(now?.stability).not.toBe(was?.stability);
    }
    expect(storedParameters()).toBeNull();

    // Under the same Parameters again, nothing.
    const after = everything();
    applyTo(own, DECK_TUNED);
    expect(everything()).toEqual(after);
  });

  test("applying the overall ones leaves the Cards of a Deck with its own unchanged", () => {
    const { own, ownCards, overallCards } = twoDecks();
    applyTo(own, DECK_TUNED);
    const before = everything();

    apply(TUNED);

    expect(cardsOf(ownCards)).toEqual({
      cards: before.cards.filter((c) => ownCards.includes(c.id)),
      reviews: before.reviews.filter((r) => ownCards.includes(r.cardId)),
    });
    expect(cardsOf(overallCards).cards[0]?.stability).not.toBe(
      before.cards.find((c) => c.id === overallCards[0])?.stability,
    );
  });

  /** `TUNED`, with a slower forgetting curve too, which changes every Interval. */
  const OWN = TUNED.map((weight, i) => (i === 20 ? 0.5 : weight));
  test("schedule a Card wherever it is scheduled: Ratings, Interval previews, rescheduling, Undo and the Queue, while another Deck stays on the overall ones", () => {
    const own = deckNamed("Own");
    const overall = deckNamed("Overall");
    const pair = (deckId: string) => {
      const easy = write(deckId, "easy");
      const good = write(deckId, "good");
      rateThrough(easy, ["easy"]);
      rateThrough(good, ["good", "good", "good"]);
      return { easy, good };
    };
    const mine = pair(own);
    const theirs = pair(overall);
    const late = { now: later(60 * DAY) };
    const progress = { reviewsShown: 0, newShown: 0, batches: 1 };
    const { studyDay } = schedulingSettingsOf(opened.db, USER);
    const settings = (parameters: readonly number[]) => ({
      ...late,
      desiredRetention: 90,
      studyDay,
      parameters,
    });

    applyTo(own, OWN);

    // Interval previews.
    expect(study.intervals(USER, mine.easy, late)).toEqual(
      previewIntervals(mine.easy, memoryOf(mine.easy), settings(OWN)),
    );
    expect(study.intervals(USER, theirs.easy, late)).toEqual(
      previewIntervals(theirs.easy, memoryOf(theirs.easy), settings(DEFAULT_PARAMETERS)),
    );
    // The Queue's Predicted recall: under the defaults a first Easy is the most at risk.
    expect(study.next(USER, own, progress, late)).toMatchObject({
      next: { card: { id: mine.good } },
    });
    expect(study.next(USER, overall, progress, late)).toMatchObject({
      next: { card: { id: theirs.easy } },
    });

    // Ratings.
    for (const [cardId, parameters] of [
      [mine.easy, OWN],
      [theirs.easy, DEFAULT_PARAMETERS],
    ] as const) {
      const was = memoryOf(cardId);
      const rated = reviews.rate(USER, cardId, { rating: "good", durationMs: 1 }, late);
      expect(rated).toMatchObject({
        schedule: scheduleOf(rate(cardId, was, "good", settings(parameters))),
      });
    }

    // Undo's restore: Deck Own's set changed the Interval its last Review gave.
    const newest = (cardId: string) =>
      opened.db
        .select({ id: review.id })
        .from(review)
        .where(eq(review.cardId, cardId))
        .orderBy(sql`${review.seq} DESC`)
        .get()?.id ?? "";
    for (const [cardId, parameters] of [
      [mine.good, OWN],
      [theirs.good, DEFAULT_PARAMETERS],
    ] as const) {
      reviews.rate(USER, cardId, { rating: "good", durationMs: 1 }, late);
      const last = opened.db
        .select({ before: review.cardBefore })
        .from(review)
        .where(eq(review.id, newest(cardId)))
        .get();
      const previous = opened.db
        .select({ reviewedAt: review.reviewedAt, rating: review.rating, before: review.cardBefore })
        .from(review)
        .where(eq(review.cardId, cardId))
        .orderBy(sql`${review.seq} DESC`)
        .limit(1)
        .offset(1)
        .get();
      if (last === undefined || previous === undefined) throw new Error("No Reviews");
      const expected = restore(
        cardId,
        fromStored(last.before),
        { ...previous, before: fromStored(previous.before) },
        settings(parameters),
      );
      expect(study.undo(USER, newest(cardId), late)).toMatchObject({
        schedule: scheduleOf(expected),
      });
    }

    // Rescheduling for a Desired retention, which the decay changes too.
    const was = { mine: memoryOf(mine.good), theirs: memoryOf(theirs.good) };
    for (const deckId of [own, overall]) {
      expect(decks.update(USER, deckId, { desiredRetention: 80 }, late.now)).not.toBe("not_found");
    }
    for (const [cardId, memory, parameters] of [
      [mine.good, was.mine, OWN],
      [theirs.good, was.theirs, DEFAULT_PARAMETERS],
    ] as const) {
      const last = lastReviewOf(opened.db, USER, cardId);
      if (last === undefined) throw new Error("No Review");
      const { dueAt, scheduledDays } = reschedule(cardId, memory, last, {
        ...settings(parameters),
        desiredRetention: 80,
      });
      expect(memoryOf(cardId)).toMatchObject({ dueAt, scheduledDays });
    }
    expect(memoryOf(mine.good).scheduledDays).not.toBe(
      reschedule(mine.good, was.mine, lastReviewOf(opened.db, USER, mine.good) ?? never(), {
        ...settings(DEFAULT_PARAMETERS),
        desiredRetention: 80,
      }).scheduledDays,
    );
  });
});

describe("a Move", () => {
  test("into a Deck with other Parameters replays the moved Cards under its own, keeping their due dates", () => {
    const from = deckNamed("From");
    const to = deckNamed("To");
    const moved = write(from, "uno");
    const stays = write(from, "dos");
    for (const cardId of [moved, stays]) rateThrough(cardId, ["again", "good", "good", "hard"]);
    applyTo(to, DECK_TUNED);
    const before = everything();

    expect(cards.move(USER, [moved], to)).not.toBe("not_found");

    const was = before.cards.find((c) => c.id === moved);
    const now = memoryOf(moved);
    expect(now).toMatchObject({ dueAt: was?.dueAt, scheduledDays: was?.scheduledDays });
    expect(now.stability).not.toBe(was?.stability);
    expect(
      everything()
        .reviews.filter((r) => r.cardId === moved)
        .map((r) => r.cardBefore),
    ).not.toEqual(before.reviews.filter((r) => r.cardId === moved).map((r) => r.cardBefore));
    // What a replay under its new Deck's Parameters works out, so another changes nothing.
    const after = everything();
    applyTo(to, DECK_TUNED);
    expect(everything()).toEqual(after);
    // The Card left behind is as it was.
    expect(memoryOf(stays)).toEqual(
      MEMORY_FROM(before.cards.find((c) => c.id === stays) ?? never()),
    );
  });

  test("between Decks with the same Parameters leaves the memory states alone", () => {
    const from = deckNamed("From");
    const to = deckNamed("To");
    const moved = write(from, "uno");
    rateThrough(moved, ["again", "good", "good", "hard"]);
    applyTo(from, DECK_TUNED);
    applyTo(to, [...DECK_TUNED]);
    const before = everything();

    expect(cards.move(USER, [moved], to)).not.toBe("not_found");

    const after = everything();
    expect(after.cards.map(MEMORY_FROM)).toEqual(before.cards.map(MEMORY_FROM));
    expect(after.reviews.map((r) => r.cardBefore)).toEqual(before.reviews.map((r) => r.cardBefore));
  });
});

/** A Card row's memory state. */
const MEMORY_FROM = ({
  state,
  dueAt,
  stability,
  difficulty,
  reps,
  lapses,
  scheduledDays,
  learningStep,
  lastReviewAt,
}: typeof card.$inferSelect): MemoryState => ({
  state,
  dueAt,
  stability,
  difficulty,
  reps,
  lapses,
  scheduledDays,
  learningStep,
  lastReviewAt,
});

const never = (): never => {
  throw new Error("Missing");
};

describe("Reset to defaults, with Decks of their own", () => {
  test("clears every Deck's own Parameters, deleted ones' too, through the same replay", async () => {
    const own = deckNamed("Own");
    const gone = deckNamed("Gone");
    for (const deckId of [own, gone]) {
      rateThrough(write(deckId, `card ${deckId}`), ["again", "good", "good", "hard"]);
    }
    decks.softDelete(USER, gone);
    const before = everything();
    applyTo(own, DECK_TUNED);
    applyTo(gone, TUNED);
    expect(tuning.status(USER)).toMatchObject({ parameters: "default", ownDecks: 2 });

    expect(await tuning.reset(USER, NOW)).toMatchObject({
      parameters: "default",
      paused: true,
      ownDecks: 0,
    });
    expect(ownParameters(own)).toBeNull();
    expect(ownParameters(gone)).toBeNull();
    expect(everything()).toEqual(before);
    expect(logRows().map((row) => row.outcome)).toEqual(["reset"]);

    expect(await tuning.reset(USER, NOW)).toBe("defaults_in_use");
  });
});

describe("a Deck's Recommended retention", () => {
  test("is worked out for its applied and kept rows from its Reviews under its own Parameters", async () => {
    const deckId = deckNamed("Spanish");
    pastReviews(deckId, DECK_TUNING_MIN_REVIEWS);
    rateMany(5);
    fitsInTurn(TUNED, DECK_TUNED);
    recommender.answers = 84;

    await tuning.tuneNow(USER, NOW);
    expect(recommender.asked.map((one) => one.parameters)).toEqual([TUNED, DECK_TUNED]);
    // The Deck's Reviews alone: none of the other Deck's 5, each its own card-day.
    expect(recommender.asked[1]?.inputs).not.toEqual(recommender.asked[0]?.inputs);
    expect(recommended()).toEqual([84, 84]);

    optimizer.losses = { current: 0.5, next: 0.5 };
    recommender.answers = 79;
    await tuning.tuneNow(USER, NOW);
    expect(recommended()).toEqual([84, 84, 79, 79]);
    expect(tuning.deckStatus(USER, deckId)).toMatchObject({ recommendedRetention: 79 });
  });

  test("is none for its failed and not_enough_data rows, and the Deck shows the newest it has", async () => {
    const deckId = deckNamed("Spanish");
    pastReviews(deckId, DECK_TUNING_MIN_REVIEWS);
    fitsInTurn(TUNED, DECK_TUNED);
    recommender.answers = 81;
    await tuning.tuneNow(USER, NOW);

    recommender.answers = 77;
    fitsInTurn(TUNED, new Error("boom"));
    await tuning.tuneNow(USER, NOW);
    fitsInTurn(TUNED, new Error("Evaluation failed: NotEnoughData"));
    await tuning.tuneNow(USER, NOW);

    expect(deckRows(deckId).map((row) => [row.outcome, row.recommendedRetention])).toEqual([
      ["applied", 81],
      ["failed", null],
      ["not_enough_data", null],
    ]);
    expect(tuning.deckStatus(USER, deckId)).toMatchObject({
      parameters: "own",
      recommendedRetention: 81,
    });
    // While the overall one is the newest overall row's.
    expect(tuning.status(USER).recommendedRetention).toBe(77);
  });

  test("is none for a kept row of a Deck that follows the overall Parameters, which shows the overall one", async () => {
    const deckId = deckNamed("Spanish");
    pastReviews(deckId, DECK_TUNING_MIN_REVIEWS);
    apply(TUNED);
    optimizer.losses = { current: 0.5, next: 0.5 };

    await tuning.tuneNow(USER, NOW);

    expect(deckRows(deckId)).toEqual([
      expect.objectContaining({ outcome: "kept", recommendedRetention: null }),
    ]);
    expect(tuning.deckStatus(USER, deckId)).toMatchObject({
      parameters: "overall",
      recommendedRetention: 84,
    });
  });

  test("goes with a Reset, and isn't brought back by a later fit whose recommendation failed", async () => {
    const deckId = deckNamed("Spanish");
    pastReviews(deckId, DECK_TUNING_MIN_REVIEWS);
    fitsInTurn(TUNED, DECK_TUNED);
    await tuning.tuneNow(USER, NOW);

    await tuning.reset(USER, NOW);
    expect(tuning.deckStatus(USER, deckId)).toMatchObject({
      parameters: "overall",
      recommendedRetention: null,
      lastAttempt: { outcome: "reset" },
    });

    fitsInTurn(new Error("Evaluation failed: NotEnoughData"), DECK_TUNED);
    recommender.fails = new Error("boom");
    await tuning.tuneNow(USER, NOW);
    expect(tuning.deckStatus(USER, deckId)).toMatchObject({
      parameters: "own",
      recommendedRetention: null,
    });
  });
});

describe("a Deck's Tuning status", () => {
  test("says whether it uses its own Parameters or the overall ones, its Reviews against the threshold, and its last attempt", async () => {
    const deckId = deckNamed("Spanish");
    pastReviews(deckId, 40);

    expect(tuning.deckStatus(USER, deckId)).toEqual({
      parameters: "overall",
      tuned: null,
      reviewCount: 40,
      threshold: DECK_TUNING_MIN_REVIEWS,
      lastAttempt: null,
      recommendedRetention: null,
    });

    pastReviews(deckId, DECK_TUNING_MIN_REVIEWS - 40, later(100 * DAY));
    fitsInTurn(TUNED, DECK_TUNED);
    await tuning.tuneNow(USER, NOW);
    // Under its threshold again, it keeps its own.
    opened.db.run(sql`DELETE FROM review WHERE rowid = (SELECT max(rowid) FROM review)`);

    expect(tuning.deckStatus(USER, deckId)).toEqual({
      parameters: "own",
      tuned: { at: NOW().toISOString(), reviews: DECK_TUNING_MIN_REVIEWS },
      reviewCount: DECK_TUNING_MIN_REVIEWS - 1,
      threshold: DECK_TUNING_MIN_REVIEWS,
      lastAttempt: { at: NOW().toISOString(), trigger: "manual", outcome: "applied" },
      recommendedRetention: 84,
    });
    await tuning.tuneNow(USER, NOW);
    expect(deckRows(deckId)).toHaveLength(1);
    expect(ownParameters(deckId)).toEqual(DECK_TUNED);
  });

  test("is not_found for a deleted Deck, an unknown one and another User's", () => {
    const deleted = deckNamed("Gone");
    decks.softDelete(USER, deleted);
    expect(tuning.deckStatus(USER, deleted)).toBe("not_found");
    expect(tuning.deckStatus(USER, "nope")).toBe("not_found");
    expect(tuning.deckStatus(USER, deckNamed("Theirs", OTHER))).toBe("not_found");
  });
});
