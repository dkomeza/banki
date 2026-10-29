import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Rating } from "@banki/shared";
import { eq, sql } from "drizzle-orm";
import { createApiKeyCipher } from "../crypto/api-key-cipher";
import { type OpenedDatabase, openDatabase } from "../db/database";
import { applyMigrations } from "../db/migrate";
import { card, review } from "../db/schema";
import { dueOnStudyDay } from "../scheduling/fsrs";
import { userHasContent } from "../seed/seed-data";
import { type CardRepository, createCardRepository } from "./cards";
import { type DeckRepository, createDeckRepository } from "./decks";
import { type DeletionRepository, createDeletionRepository } from "./deletions";
import { type ReviewRepository, createReviewRepository } from "./reviews";
import { type SettingsRepository, createSettingsRepository } from "./settings";
import { createUserRepository } from "./user";

let tempDir: string;
let opened: OpenedDatabase;
let cards: CardRepository;
let decks: DeckRepository;
let deletions: DeletionRepository;
let reviews: ReviewRepository;
let settings: SettingsRepository;

const USER = "user-1";
const OTHER = "user-2";
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "banki-reviews-"));
  opened = openDatabase(tempDir);
  applyMigrations(opened.db);
  const users = createUserRepository(opened.db);
  users.createWithPassword({ userId: USER, accountId: "a1", email: "u@x.y", passwordHash: "h" });
  opened.db.run(
    sql`INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (${OTHER}, 'n', 'o@x.y', 1, 0, 0)`,
  );
  cards = createCardRepository(opened.db);
  decks = createDeckRepository(opened.db);
  deletions = createDeletionRepository(opened.db);
  reviews = createReviewRepository(opened.db);
  settings = createSettingsRepository(opened.db, createApiKeyCipher(Buffer.alloc(32, 7)));
});

afterEach(() => {
  opened.close();
  rmSync(tempDir, { recursive: true, force: true });
});

const at = (iso: string) => new Date(iso);
const START = at("2026-05-01T10:00:00Z");
const UTC4 = { timezone: "UTC", dayStartHour: 4 };

const deckNamed = (name: string, userId = USER) => {
  const created = decks.create(userId, { name, description: null, folderId: null });
  if (typeof created === "string") throw new Error(`${name}: ${created}`);
  return created.id;
};

const write = (deckId: string, front = "front", userId = USER) => {
  const created = cards.create(userId, deckId, { front, back: "back" });
  if (typeof created === "string") throw new Error(`${front}: ${created}`);
  return created.id;
};

const rowOf = (id: string) => opened.db.select().from(card).where(eq(card.id, id)).get();
const reviewsOf = (cardId: string) =>
  opened.db.select().from(review).where(eq(review.cardId, cardId)).all();

/** Rates a Card, answering what the repository did. */
const give = (cardId: string, rating: Rating, now: Date, durationMs = 4000) => {
  const rated = reviews.rate(USER, cardId, { rating, durationMs }, { now });
  if (rated === "not_found") throw new Error(`${cardId}: not_found`);
  return rated;
};

/** Rates a Card Good until it is past its learning steps, each at its due moment. */
const graduate = (cardId: string, from = START) => {
  let now = from;
  let rated = give(cardId, "good", now);
  while (rated.schedule.state !== "review") {
    now = new Date(rated.schedule.due ?? now);
    rated = give(cardId, "good", now);
  }
  return { rated, reviewedAt: now };
};

describe("rate", () => {
  test("records one self-rated Review with the memory state before it, and reschedules the Card", () => {
    const deckId = deckNamed("Spanish");
    const cardId = write(deckId);

    const rated = reviews.rate(
      USER,
      cardId,
      { rating: "good", durationMs: 5300 },
      {
        id: "review-1",
        now: START,
      },
    );

    expect(rated).toEqual({
      review: {
        id: "review-1",
        cardId,
        deckId,
        reviewedAt: START.toISOString(),
        rating: "good",
        kind: "self-rated",
        durationMs: 5300,
      },
      schedule: {
        state: "learning",
        due: new Date(START.getTime() + 10 * MINUTE).toISOString(),
        stability: expect.any(Number),
        difficulty: expect.any(Number),
        reps: 1,
        lapses: 0,
        scheduledDays: 0,
        lastReview: START.toISOString(),
      },
    });
    const [stored] = reviewsOf(cardId);
    expect(stored).toMatchObject({
      id: "review-1",
      userId: USER,
      cardId,
      deckId,
      reviewedAt: START,
      rating: "good",
      kind: "self-rated",
      durationMs: 5300,
      cardBefore: { state: "new", dueAt: null, reps: 0, stability: 0, lastReviewAt: null },
    });
    expect(rowOf(cardId)).toMatchObject({
      state: "learning",
      dueAt: new Date(START.getTime() + 10 * MINUTE),
      reps: 1,
      lastReviewAt: START,
    });
  });

  test("a Card is new, with no due moment, until its first Review", () => {
    const cardId = write(deckNamed("Spanish"));

    expect(rowOf(cardId)).toMatchObject({ state: "new", dueAt: null, reps: 0 });
  });

  test("keeps the memory state each Review started from", () => {
    const cardId = write(deckNamed("Spanish"));
    const first = give(cardId, "good", START);

    give(cardId, "good", new Date(first.schedule.due ?? START));

    const kept = reviewsOf(cardId).map((row) => row.cardBefore);
    expect(kept).toEqual([
      expect.objectContaining({ state: "new", reps: 0 }),
      expect.objectContaining({
        state: "learning",
        reps: 1,
        dueAt: first.schedule.due,
        stability: first.schedule.stability,
      }),
    ]);
  });

  test("past its learning steps, a Card is due from the Day start of its Study day, in the User's Timezone", () => {
    settings.update(USER, { timezone: "America/New_York", dayStartHour: 5 });
    const cardId = write(deckNamed("Spanish"));

    const { rated, reviewedAt } = graduate(cardId);

    const days = rated.schedule.scheduledDays;
    expect(days).toBeGreaterThanOrEqual(1);
    expect(rated.schedule.due).toBe(
      dueOnStudyDay(reviewedAt, days, {
        timezone: "America/New_York",
        dayStartHour: 5,
      }).toISOString(),
    );
    // 5:00 a.m. in New York (UTC-4 in May) is 09:00Z.
    expect(rated.schedule.due?.slice(11)).toBe("09:00:00.000Z");
  });

  test("schedules at the Deck's Desired retention: its own, or Settings'", () => {
    const followsId = deckNamed("Follows");
    const ownId = deckNamed("Own");
    decks.update(USER, ownId, { desiredRetention: 70 });
    const a = write(followsId);
    const b = write(ownId);
    const { reviewedAt: ra } = graduate(a);
    const { reviewedAt: rb } = graduate(b);

    // The same Ratings at the same moments, from the same state: only the retention differs.
    expect(ra).toEqual(rb);
    const atFollows = give(a, "good", new Date(ra.getTime() + 30 * DAY));
    const atOwn = give(b, "good", new Date(rb.getTime() + 30 * DAY));
    expect(atOwn.schedule.scheduledDays).toBeGreaterThan(atFollows.schedule.scheduledDays);
  });

  test("a deleted Card, a Card in a deleted Deck, another User's and a missing one are not_found", () => {
    const deckId = deckNamed("Spanish");
    const deleted = write(deckId, "deleted");
    cards.softDelete(USER, deleted);
    const goneDeck = deckNamed("Gone");
    const inGoneDeck = write(goneDeck, "in gone deck");
    decks.softDelete(USER, goneDeck);
    const others = write(deckNamed("Theirs", OTHER), "theirs", OTHER);

    for (const id of [deleted, inGoneDeck, others, "missing"]) {
      expect(reviews.rate(USER, id, { rating: "good", durationMs: 0 }, { now: START })).toBe(
        "not_found",
      );
    }
    expect(opened.db.select().from(review).all()).toEqual([]);
  });

  test("a Review makes the User's content, for `banki seed`", () => {
    const cardId = write(deckNamed("Spanish"));
    give(cardId, "good", START);
    // Gone from every other table, the Review still counts.
    opened.db.run(sql`DELETE FROM card`);
    opened.db.run(sql`DELETE FROM deck`);

    expect(userHasContent(opened.db, USER)).toBe(true);
  });
});

/** A Deck with a new Card, a learning Card and a Card past its learning steps. */
const deckWithEveryState = (name: string) => {
  const deckId = deckNamed(name);
  const fresh = write(deckId, "new");
  const learning = write(deckId, "learning");
  give(learning, "good", START);
  const reviewing = write(deckId, "review");
  graduate(reviewing);
  return { deckId, fresh, learning, reviewing };
};

const snapshot = (...ids: string[]) => ids.map((id) => rowOf(id));

describe("a change of Desired retention", () => {
  test("in Settings reschedules every Card past its learning steps in the Decks that follow it, deleted ones too", () => {
    settings.update(USER, { timezone: "UTC" });
    const follows = deckWithEveryState("Follows");
    const own = deckWithEveryState("Own");
    decks.update(USER, own.deckId, { desiredRetention: 90 });
    const deletedCard = write(follows.deckId, "deleted card");
    graduate(deletedCard);
    cards.softDelete(USER, deletedCard);
    const deletedDeck = deckWithEveryState("Deleted deck");
    decks.softDelete(USER, deletedDeck.deckId);
    const untouched = snapshot(follows.fresh, follows.learning, ...Object.values(own).slice(1));
    const before = snapshot(follows.reviewing, deletedCard, deletedDeck.reviewing);

    settings.update(USER, { desiredRetention: 70 }, START);

    const after = snapshot(follows.reviewing, deletedCard, deletedDeck.reviewing);
    after.forEach((row, i) => {
      expect(row?.scheduledDays).toBeGreaterThan(before[i]?.scheduledDays ?? Infinity);
      expect(row?.dueAt?.getTime()).toBeGreaterThan(before[i]?.dueAt?.getTime() ?? Infinity);
      // Only the due date moves; the memory state stays.
      expect(row?.stability).toBe(before[i]?.stability ?? NaN);
      expect(row?.reps).toBe(before[i]?.reps ?? NaN);
    });
    expect(snapshot(follows.fresh, follows.learning, ...Object.values(own).slice(1))).toEqual(
      untouched,
    );
    expect(settings.get(USER).desiredRetention).toBe(70);
  });

  test("puts the due date at the last Review plus the new interval, or now when that has passed", () => {
    settings.update(USER, { timezone: "UTC" });
    const deckId = deckNamed("Spanish");
    const cardId = write(deckId);
    const { reviewedAt } = graduate(cardId);

    settings.update(USER, { desiredRetention: 80 }, reviewedAt);
    const row = rowOf(cardId);
    expect(row?.dueAt).toEqual(dueOnStudyDay(reviewedAt, row?.scheduledDays ?? 0, UTC4));

    const later = at("2027-06-01T12:00:00Z");
    settings.update(USER, { desiredRetention: 97 }, later);
    expect(rowOf(cardId)?.dueAt).toEqual(later);
  });

  test("going back to the old value puts every due date back", () => {
    const { reviewing } = deckWithEveryState("Spanish");
    const before = rowOf(reviewing);

    settings.update(USER, { desiredRetention: 75 }, START);
    settings.update(USER, { desiredRetention: 90 }, START);

    expect(rowOf(reviewing)).toEqual(before);
  });

  test("in a Deck reschedules that Deck's Cards, and following Settings again does too", () => {
    const spanish = deckWithEveryState("Spanish");
    const french = deckWithEveryState("French");
    const frenchBefore = snapshot(...Object.values(french).slice(1));
    const before = rowOf(spanish.reviewing);
    const untouched = snapshot(spanish.fresh, spanish.learning);

    const changed = decks.update(USER, spanish.deckId, { desiredRetention: 75 }, START);

    expect(changed).toMatchObject({ desiredRetention: 75 });
    expect(rowOf(spanish.reviewing)?.scheduledDays).toBeGreaterThan(before?.scheduledDays ?? 0);
    expect(snapshot(spanish.fresh, spanish.learning)).toEqual(untouched);
    expect(snapshot(...Object.values(french).slice(1))).toEqual(frenchBefore);

    const following = decks.update(USER, spanish.deckId, { desiredRetention: null }, START);

    expect(following).toMatchObject({ desiredRetention: null });
    expect(rowOf(spanish.reviewing)).toEqual(before);
  });

  test("a Deck's own value equal to Settings' reschedules nothing, and moves with no change to Settings", () => {
    const { deckId, reviewing } = deckWithEveryState("Spanish");
    const before = rowOf(reviewing);

    decks.update(USER, deckId, { desiredRetention: 90 }, at("2030-01-01T00:00:00Z"));
    expect(rowOf(reviewing)).toEqual(before);

    // Its own 90 holds when Settings change.
    settings.update(USER, { desiredRetention: 70 }, START);
    expect(rowOf(reviewing)).toEqual(before);
  });

  test("leaves another User's Cards alone", () => {
    const theirDeck = deckNamed("Theirs", OTHER);
    const theirs = write(theirDeck, "theirs", OTHER);
    const rated = reviews.rate(OTHER, theirs, { rating: "easy", durationMs: 0 }, { now: START });
    if (rated === "not_found") throw new Error("not_found");
    const before = rowOf(theirs);

    settings.update(USER, { desiredRetention: 70 }, START);

    expect(rowOf(theirs)).toEqual(before);
  });
});

describe("a Move", () => {
  test("takes the moved Cards' Reviews to the new Deck, and only theirs", () => {
    const from = deckNamed("From");
    const to = deckNamed("To");
    const moved = write(from, "moved");
    const stays = write(from, "stays");
    give(moved, "good", START);
    give(moved, "again", new Date(START.getTime() + 10 * MINUTE));
    give(stays, "good", START);

    cards.move(USER, [moved], to);

    expect(reviewsOf(moved).map((row) => row.deckId)).toEqual([to, to]);
    expect(reviewsOf(stays).map((row) => row.deckId)).toEqual([from]);
  });

  test("reschedules the moved Cards when the new Deck's Desired retention differs", () => {
    const from = deckNamed("From");
    const same = deckNamed("Same");
    const lower = deckNamed("Lower");
    decks.update(USER, lower, { desiredRetention: 70 });
    const a = write(from, "a");
    const b = write(from, "b");
    graduate(a);
    graduate(b);
    const beforeA = rowOf(a);
    const beforeB = rowOf(b);

    cards.move(USER, [a], same, START);
    cards.move(USER, [b], lower, START);

    expect(rowOf(a)).toMatchObject({
      deckId: same,
      dueAt: beforeA?.dueAt,
      scheduledDays: beforeA?.scheduledDays,
    });
    expect(rowOf(b)?.scheduledDays).toBeGreaterThan(beforeB?.scheduledDays ?? 0);
  });
});

describe("Removal", () => {
  test("of a Card, or of its Deck, leaves its Reviews in place", () => {
    const deckId = deckNamed("Spanish");
    const alone = write(deckId, "alone");
    const withDeck = write(deckId, "with deck");
    give(alone, "good", START);
    give(withDeck, "hard", START);
    const cardDeletion = cards.softDelete(USER, alone);
    if (cardDeletion === undefined) throw new Error("not deleted");
    deletions.remove(USER, cardDeletion);
    const deckDeletion = decks.softDelete(USER, deckId);
    if (deckDeletion === undefined) throw new Error("not deleted");
    deletions.remove(USER, deckDeletion);

    expect(rowOf(alone)).toBeUndefined();
    expect(rowOf(withDeck)).toBeUndefined();
    expect(reviewsOf(alone)).toHaveLength(1);
    expect(reviewsOf(withDeck)).toMatchObject([{ deckId, rating: "hard" }]);
  });
});
