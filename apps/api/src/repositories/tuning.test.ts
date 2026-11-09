import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Rating, TUNING_REVIEW_INTERVAL } from "@banki/shared";
import { asc, eq, sql } from "drizzle-orm";
import { type OpenedDatabase, openDatabase } from "../db/database";
import { applyMigrations } from "../db/migrate";
import { card, parameter_tuning, review, user_settings } from "../db/schema";
import { DEFAULT_PARAMETERS, type MemoryState, rate } from "../scheduling/fsrs";
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
  schedulingSettingsOf,
} from "./reviews";
import { type StudyRepository, createStudyRepository } from "./study";
import { type TuningRepository, applyParameters, createTuningRepository } from "./tuning";
import { createUserRepository } from "./user";

let tempDir: string;
let opened: OpenedDatabase;
let cards: CardRepository;
let decks: DeckRepository;
let reviews: ReviewRepository;
let study: StudyRepository;
let tuning: TuningRepository;
let optimizer: StubOptimizer;
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
  losses: { current: number; next: number };
  fails: Error | undefined;
  /** Until it settles, fitting waits. */
  gate: Promise<void>;
  fitted: TrainingItem[][];
};

const stubOptimizer = (): StubOptimizer => {
  const stub: StubOptimizer = {
    produces: TUNED,
    losses: { current: 0.5, next: 0.4 },
    fails: undefined,
    gate: Promise.resolve(),
    fitted: [],
    async computeParameters(items) {
      stub.fitted.push(items);
      await stub.gate;
      if (stub.fails !== undefined) throw stub.fails;
      return stub.produces;
    },
    evaluate: (parameters) =>
      parameters === stub.produces ? stub.losses.next : stub.losses.current,
  };
  return stub;
};

const gate = () => {
  let open = () => {};
  const closed = new Promise<void>((resolve) => {
    open = resolve;
  });
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
  tuning = createTuningRepository(opened.db, { optimizer });
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

describe("applying Parameters", () => {
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
        const was = fromStored(before.reviews.find((r) => r.id === one.id)?.cardBefore);
        expect(stored).toMatchObject({
          dueAt: was.dueAt,
          scheduledDays: was.scheduledDays,
          lastReviewAt: was.lastReviewAt,
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
