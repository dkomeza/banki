import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_DAY_START_HOUR, DEFAULT_DESIRED_RETENTION, type Rating } from "@banki/shared";
import { sql } from "drizzle-orm";
import { type OpenedDatabase, openDatabase } from "../db/database";
import { applyMigrations } from "../db/migrate";
import { NEW_MEMORY_STATE, previewIntervals } from "../scheduling/fsrs";
import type { QueueProgress } from "../scheduling/queue";
import { type CardRepository, createCardRepository } from "./cards";
import { type DeckRepository, createDeckRepository } from "./decks";
import { type ReviewRepository, createReviewRepository } from "./reviews";
import { type StudyRepository, createStudyRepository } from "./study";
import { createUserRepository } from "./user";

let tempDir: string;
let opened: OpenedDatabase;
let cards: CardRepository;
let decks: DeckRepository;
let reviews: ReviewRepository;
let study: StudyRepository;

const USER = "user-1";
const OTHER = "user-2";
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const START = new Date("2026-05-01T10:00:00Z");
const later = (ms: number) => new Date(START.getTime() + ms);

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "banki-study-"));
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
  cards = createCardRepository(opened.db);
  decks = createDeckRepository(opened.db);
  reviews = createReviewRepository(opened.db);
  study = createStudyRepository(opened.db);
});

afterEach(() => {
  opened.close();
  rmSync(tempDir, { recursive: true, force: true });
});

const deckNamed = (name: string, userId = USER) => {
  const created = decks.create(userId, { name, description: null, folderId: null });
  if (typeof created === "string") throw new Error(`${name}: ${created}`);
  return created.id;
};

/** Writes a Card `id`, `minutesBefore` the Session starts. */
const write = (deckId: string, id: string, minutesBefore: number, userId = USER) => {
  const created = cards.create(
    userId,
    deckId,
    { front: id, back: "back" },
    { id, now: later(-minutesBefore * MINUTE) },
  );
  if (typeof created === "string") throw new Error(`${id}: ${created}`);
};

const give = (cardId: string, rating: Rating, now: Date) => {
  const rated = reviews.rate(USER, cardId, { rating, durationMs: 1000 }, { now });
  if (rated === "not_found") throw new Error(`${cardId}: not_found`);
  return rated;
};

describe("next", () => {
  test("walks a whole Session through Ratings, learning Cards back between others and shown early at the end", () => {
    const deckId = deckNamed("Spanish");
    write(deckId, "a", 30);
    write(deckId, "b", 20);
    write(deckId, "c", 10);
    const progress: QueueProgress = { reviewsShown: 0, newShown: 0, batches: 1 };
    const shown: Array<[string, string]> = [];

    /** Asks for the next Card at `now`, counts it as the client would, and rates it. */
    const step = (now: Date, rating: Rating) => {
      const answer = study.next(USER, deckId, progress, { now });
      if (answer === "not_found" || answer.next === null) throw new Error("Queue ran out early");
      const { card, kind, schedule } = answer.next;
      shown.push([card.id, kind]);
      expect(card.deckId).toBe(deckId);
      expect(schedule.state).toBe(kind === "learning" ? "learning" : kind);
      if (kind === "new") progress.newShown += 1;
      if (kind === "review") progress.reviewsShown += 1;
      progress.after = card.id;
      return give(card.id, rating, now).schedule;
    };

    // a: Again, back in 1 minute; b in the meantime.
    expect(step(START, "again")).toMatchObject({ state: "learning" });
    expect(step(later(5 * SECOND), "good")).toMatchObject({ state: "learning" });
    // a's step is over: it comes back before c, with b in between.
    step(later(70 * SECOND), "good");
    step(later(80 * SECOND), "easy");
    // Nothing is due: the learning Cards are shown early, the earliest due first.
    step(later(90 * SECOND), "good");
    step(later(100 * SECOND), "good");

    expect(shown).toEqual([
      ["a", "new"],
      ["b", "new"],
      ["a", "learning"],
      ["c", "new"],
      ["b", "learning"],
      ["a", "learning"],
    ]);
    expect(study.next(USER, deckId, progress, { now: later(110 * SECOND) })).toEqual({
      next: null,
      newHeld: 0,
    });
  });

  test("answers the Card as the API does, with its Tags, schedule, kind and Interval previews", () => {
    const deckId = deckNamed("Spanish");
    cards.create(
      USER,
      deckId,
      { front: "hola", back: "hello", tags: ["greeting"] },
      { id: "c1", now: START },
    );

    expect(
      study.next(USER, deckId, { reviewsShown: 0, newShown: 0, batches: 1 }, { now: START }),
    ).toEqual({
      next: {
        card: {
          id: "c1",
          deckId,
          front: "hola",
          back: "hello",
          tags: ["greeting"],
          createdAt: START.toISOString(),
          updatedAt: START.toISOString(),
        },
        schedule: {
          state: "new",
          due: null,
          stability: 0,
          difficulty: 0,
          reps: 0,
          lapses: 0,
          scheduledDays: 0,
          lastReview: null,
        },
        kind: "new",
        intervals: previewIntervals("c1", NEW_MEMORY_STATE, {
          now: START,
          desiredRetention: DEFAULT_DESIRED_RETENTION,
          studyDay: { timezone: null, dayStartHour: DEFAULT_DAY_START_HOUR },
        }),
      },
      newHeld: 0,
    });
  });

  test("leaves out deleted Cards and other Decks' Cards", () => {
    const deckId = deckNamed("Spanish");
    const otherDeck = deckNamed("French");
    write(deckId, "gone", 20);
    write(otherDeck, "elsewhere", 30);
    write(deckId, "kept", 10);
    cards.softDelete(USER, "gone");

    expect(
      study.next(USER, deckId, { reviewsShown: 0, newShown: 0, batches: 1 }, { now: START }),
    ).toMatchObject({
      next: { card: { id: "kept" } },
    });
  });

  test("answers next: null when no Card is due and none is in learning", () => {
    const deckId = deckNamed("Spanish");
    write(deckId, "a", 10);
    give("a", "easy", START);

    expect(
      study.next(
        USER,
        deckId,
        { reviewsShown: 0, newShown: 0, batches: 1 },
        { now: later(MINUTE) },
      ),
    ).toEqual({
      next: null,
      newHeld: 0,
    });
  });

  test("paces New cards by the User's stored New-card batch and Learning limit", () => {
    const deckId = deckNamed("Spanish");
    for (const [i, id] of ["a", "b", "c", "d", "e", "f", "g"].entries()) write(deckId, id, 70 - i);
    const done = { reviewsShown: 0, newShown: 5, batches: 1 };

    // The defaults: a batch of 20.
    expect(study.next(USER, deckId, done, { now: START })).toMatchObject({
      next: { card: { id: "a" }, kind: "new" },
      newHeld: 0,
    });

    opened.db.run(
      sql`INSERT INTO user_settings (user_id, new_card_batch, learning_limit) VALUES (${USER}, 5, 5)`,
    );
    expect(study.next(USER, deckId, done, { now: START })).toEqual({ next: null, newHeld: 7 });

    // Another batch, but five Cards in learning: the Learning limit holds.
    for (const id of ["a", "b", "c", "d", "e"]) give(id, "again", START);
    expect(
      study.next(USER, deckId, { ...done, batches: 2, after: "e" }, { now: later(SECOND) }),
    ).toMatchObject({ next: { card: { id: "a" }, kind: "learning" }, newHeld: 0 });
  });

  test("is not_found for a deleted, unknown or other User's Deck", () => {
    const deleted = deckNamed("Spanish");
    decks.softDelete(USER, deleted);
    const others = deckNamed("Theirs", OTHER);
    write(others, "theirs", 10, OTHER);

    for (const deckId of [deleted, "missing", others]) {
      expect(study.next(USER, deckId, { reviewsShown: 0, newShown: 0, batches: 1 })).toBe(
        "not_found",
      );
    }
  });
});
