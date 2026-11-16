import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Rating, Statistics } from "@banki/shared";
import { sql } from "drizzle-orm";
import { type OpenedDatabase, openDatabase } from "../db/database";
import { applyMigrations } from "../db/migrate";
import { type CardRepository, createCardRepository } from "./cards";
import { type DeckRepository, createDeckRepository } from "./decks";
import { removeDeletion } from "./deletions";
import { type ReviewRepository, createReviewRepository } from "./reviews";
import { type StatisticsRepository, createStatisticsRepository } from "./statistics";
import { createUserRepository } from "./user";

let tempDir: string;
let opened: OpenedDatabase;
let cards: CardRepository;
let decks: DeckRepository;
let reviews: ReviewRepository;
let statistics: StatisticsRepository;

const USER = "user-1";
const OTHER = "user-2";
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
/** Friday 13 November 2026, 12:00 in Warsaw. */
const NOW = new Date("2026-11-13T11:00:00Z");
const daysAgo = (days: number, at = NOW) => new Date(at.getTime() - days * DAY);
const HAIKU = "anthropic/claude-haiku-5.5";

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "banki-statistics-"));
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
  settings({ timezone: "Europe/Warsaw", dayStartHour: 4, desiredRetention: 90 });
  cards = createCardRepository(opened.db);
  decks = createDeckRepository(opened.db);
  reviews = createReviewRepository(opened.db);
  statistics = createStatisticsRepository(opened.db);
});

afterEach(() => {
  opened.close();
  rmSync(tempDir, { recursive: true, force: true });
});

function settings({
  timezone,
  dayStartHour,
  desiredRetention,
}: {
  timezone: string;
  dayStartHour: number;
  desiredRetention: number;
}) {
  opened.db.run(
    sql`INSERT INTO user_settings (user_id, timezone, day_start_hour, desired_retention) VALUES (${USER}, ${timezone}, ${dayStartHour}, ${desiredRetention})
        ON CONFLICT (user_id) DO UPDATE SET timezone = excluded.timezone, day_start_hour = excluded.day_start_hour, desired_retention = excluded.desired_retention`,
  );
}

const deckNamed = (name: string, userId = USER) => {
  const created = decks.create(userId, { name, description: null, folderId: null });
  if (typeof created === "string") throw new Error(`${name}: ${created}`);
  return created.id;
};

let made = 0;
const cardIn = (deckId: string, userId = USER) => {
  const id = `card-${++made}`;
  const created = cards.create(userId, deckId, { front: id, back: "b" }, { id, now: daysAgo(400) });
  if (typeof created === "string") throw new Error(`${id}: ${created}`);
  return id;
};

const give = (
  cardId: string,
  rating: Rating,
  at: Date,
  {
    durationMs = 60_000,
    suggested,
    model = HAIKU,
    userId = USER,
  }: { durationMs?: number; suggested?: Rating; model?: string; userId?: string } = {},
) => {
  const rated = reviews.rate(
    userId,
    cardId,
    suggested === undefined
      ? { rating, durationMs }
      : { rating, durationMs, suggestedRating: suggested, model },
    { now: at },
  );
  if (rated === "not_found") throw new Error(`${cardId}: not_found`);
};

/** A Card already a Learned card: rated Easy when new. */
const learnedIn = (deckId: string, at = daysAgo(200)) => {
  const id = cardIn(deckId);
  give(id, "easy", at);
  return id;
};

const overall = (range: "7" | "30" | "90" | "all" = "30", now = NOW) =>
  Statistics.parse(statistics.overall(USER, range, { now }));

const ofDeck = (deckId: string, range: "7" | "30" | "90" | "all" = "30", now = NOW) => {
  const found = statistics.deck(USER, deckId, range, { now });
  if (found === "not_found") throw new Error("not_found");
  return Statistics.parse(found);
};

describe("the range", () => {
  test("N days are today and the N−1 Study days before it", () => {
    expect(overall("7")).toMatchObject({ range: "7", from: "2026-11-07", to: "2026-11-13" });
    expect(overall("30")).toMatchObject({ from: "2026-10-15", to: "2026-11-13" });
    expect(overall("90")).toMatchObject({ from: "2026-08-16", to: "2026-11-13" });
  });

  test("All time starts on the first Study day with a Review, or today with none", () => {
    expect(overall("all")).toMatchObject({ from: "2026-11-13", to: "2026-11-13" });
    const deckId = deckNamed("Spanish");
    give(cardIn(deckId), "good", daysAgo(10));
    expect(overall("all")).toMatchObject({ from: "2026-11-03" });
  });

  test("today is the Study day of now", () => {
    // 03:00 in Warsaw on the 14th is still the 13th's Study day with a 04:00 Day start.
    expect(overall("7", new Date("2026-11-14T02:00:00Z")).to).toBe("2026-11-13");
    expect(overall("7", new Date("2026-11-14T03:00:00Z")).to).toBe("2026-11-14");
  });
});

describe("Study days", () => {
  test("a Review at 01:00 counts toward the day before", () => {
    const deckId = deckNamed("Spanish");
    // 01:00 in Warsaw on 12 November.
    give(cardIn(deckId), "good", new Date("2026-11-12T00:00:00Z"), { durationMs: 90_000 });
    const stats = overall("7");
    expect(stats.calendar).toEqual([{ day: "2026-11-11", reviews: 1, ms: 90_000 }]);
    expect(stats.minutes.points.find((p) => p.ms > 0)).toEqual({ start: "2026-11-11", ms: 90_000 });
  });

  test("follow the current Timezone and Day start", () => {
    const deckId = deckNamed("Spanish");
    give(cardIn(deckId), "good", new Date("2026-11-12T00:00:00Z"));
    settings({ timezone: "America/New_York", dayStartHour: 0, desiredRetention: 90 });
    // 19:00 on 11 November in New York.
    expect(overall("7").calendar.map((d) => d.day)).toEqual(["2026-11-11"]);
  });

  test("a DST change day buckets correctly", () => {
    const deckId = deckNamed("Spanish");
    // Warsaw falls back at 01:00Z on 25 October 2026, 03:00 CEST becoming 02:00
    // CET, so the 24th's Study day runs 25 hours: from 04:00 CEST (02:00Z) on
    // the 24th to 04:00 CET (03:00Z) on the 25th.
    give(cardIn(deckId), "good", new Date("2026-10-24T01:30:00Z"));
    give(cardIn(deckId), "good", new Date("2026-10-25T00:30:00Z"));
    give(cardIn(deckId), "good", new Date("2026-10-25T02:30:00Z"));
    give(cardIn(deckId), "good", new Date("2026-10-25T03:00:00Z"));
    give(cardIn(deckId), "good", new Date("2026-10-26T02:30:00Z"));
    give(cardIn(deckId), "good", new Date("2026-10-26T03:00:00Z"));
    const days = Object.fromEntries(overall("30").calendar.map((d) => [d.day, d.reviews]));
    expect(days).toEqual({ "2026-10-23": 1, "2026-10-24": 2, "2026-10-25": 2, "2026-10-26": 1 });
  });
});

describe("what counts", () => {
  test("Reviews of deleted and Removed Cards and Decks count globally", () => {
    const spanish = deckNamed("Spanish");
    const french = deckNamed("French");
    const deleted = cardIn(spanish);
    const removed = cardIn(spanish);
    const inRemovedDeck = cardIn(french);
    give(deleted, "good", daysAgo(3));
    give(removed, "good", daysAgo(3));
    give(inRemovedDeck, "good", daysAgo(3));
    cards.softDelete(USER, deleted, daysAgo(1));
    removeDeletion(opened.db, USER, cards.softDelete(USER, removed, daysAgo(1)) ?? "");
    removeDeletion(opened.db, USER, decks.softDelete(USER, french, daysAgo(1)) ?? "");
    expect(overall("7").calendar).toEqual([{ day: "2026-11-10", reviews: 3, ms: 180_000 }]);
  });

  test("a Deck's page counts the Reviews whose Deck it is, a moved Card's and a Removed Card's included", () => {
    const spanish = deckNamed("Spanish");
    const french = deckNamed("French");
    const moved = cardIn(french);
    const removed = cardIn(spanish);
    give(moved, "good", daysAgo(2));
    give(removed, "good", daysAgo(2));
    give(cardIn(french), "good", daysAgo(2));
    cards.move(USER, [moved], spanish, daysAgo(1));
    removeDeletion(opened.db, USER, cards.softDelete(USER, removed, daysAgo(1)) ?? "");
    expect(ofDeck(spanish, "7").calendar).toEqual([{ day: "2026-11-11", reviews: 2, ms: 120_000 }]);
    expect(ofDeck(french, "7").calendar).toEqual([{ day: "2026-11-11", reviews: 1, ms: 60_000 }]);
  });

  test("another User's Reviews never count", () => {
    const theirs = deckNamed("Theirs", OTHER);
    give(cardIn(theirs, OTHER), "good", daysAgo(1), { userId: OTHER });
    expect(overall("7").calendar).toEqual([]);
  });

  test("a deleted, unknown or other User's Deck is not found", () => {
    const deleted = deckNamed("Gone");
    decks.softDelete(USER, deleted, daysAgo(1));
    const theirs = deckNamed("Theirs", OTHER);
    for (const deckId of [deleted, theirs, "nope"])
      expect(statistics.deck(USER, deckId, "30", { now: NOW })).toBe("not_found");
  });
});

describe("Actual retention", () => {
  test("counts only Reviews of Learned cards, with Again as not recalled", () => {
    const deckId = deckNamed("Spanish");
    const a = learnedIn(deckId);
    const b = learnedIn(deckId);
    const c = learnedIn(deckId);
    give(a, "good", daysAgo(5));
    give(b, "hard", daysAgo(5));
    give(c, "again", daysAgo(5));
    // c is relearning now: this Review isn't of a Learned card.
    give(c, "good", daysAgo(4));
    // New and learning Cards' Reviews don't count.
    const fresh = cardIn(deckId);
    give(fresh, "again", daysAgo(3));
    give(fresh, "again", daysAgo(2));
    expect(overall("7").actualRetention).toEqual({ recalled: 2, total: 3, desiredRetention: 90 });
  });

  test("counts the range's Reviews only", () => {
    const deckId = deckNamed("Spanish");
    const a = learnedIn(deckId);
    give(a, "again", daysAgo(10));
    expect(overall("7").actualRetention.total).toBe(0);
    expect(overall("30").actualRetention).toMatchObject({ recalled: 0, total: 1 });
  });

  test("on a Deck's page compares with its own Desired retention, or Settings'", () => {
    const own = deckNamed("Own");
    const follows = deckNamed("Follows");
    decks.update(USER, own, { desiredRetention: 80 });
    give(learnedIn(own), "good", daysAgo(1));
    expect(ofDeck(own).actualRetention.desiredRetention).toBe(80);
    expect(ofDeck(follows).actualRetention.desiredRetention).toBe(90);
  });

  test("globally compares with the Desired retention weighted by the counted Reviews, a Removed Deck as Settings'", () => {
    const own = deckNamed("Own");
    const removed = deckNamed("Removed");
    decks.update(USER, own, { desiredRetention: 80 });
    decks.update(USER, removed, { desiredRetention: 70 });
    for (const _ of [1, 2, 3]) give(learnedIn(own), "good", daysAgo(1));
    give(learnedIn(removed), "good", daysAgo(1));
    // A new Card's Review counts for no one's weight.
    give(cardIn(removed), "good", daysAgo(1));
    expect(overall().actualRetention.desiredRetention).toBe((3 * 80 + 70) / 4);
    removeDeletion(opened.db, USER, decks.softDelete(USER, removed, daysAgo(0)) ?? "");
    expect(overall().actualRetention.desiredRetention).toBe((3 * 80 + 90) / 4);
  });

  test("with no Reviews of Learned cards, compares with Settings'", () => {
    expect(overall().actualRetention).toEqual({ recalled: 0, total: 0, desiredRetention: 90 });
  });
});

describe("Cards by stage", () => {
  test("counts live Cards by state, leaving out deleted Cards and Cards in deleted Decks", () => {
    const spanish = deckNamed("Spanish");
    const gone = deckNamed("Gone");
    cardIn(spanish);
    learnedIn(spanish);
    const learning = cardIn(spanish);
    give(learning, "good", daysAgo(1));
    const relearning = learnedIn(spanish);
    give(relearning, "again", daysAgo(1));
    cards.softDelete(USER, cardIn(spanish), daysAgo(1));
    cardIn(gone);
    decks.softDelete(USER, gone, daysAgo(1));
    cardIn(deckNamed("Theirs", OTHER), OTHER);
    expect(overall().cards).toEqual({ new: 1, learning: 2, learned: 1 });
    expect(ofDeck(spanish).cards).toEqual({ new: 1, learning: 2, learned: 1 });
  });

  test("a Deck's page counts its own Cards", () => {
    const spanish = deckNamed("Spanish");
    cardIn(spanish);
    cardIn(deckNamed("French"));
    expect(ofDeck(spanish).cards).toEqual({ new: 1, learning: 0, learned: 0 });
  });
});

describe("Grader agreement", () => {
  test("counts kept, higher and lower, overall and per Model, leaving out self-rated Reviews", () => {
    const deckId = deckNamed("Spanish");
    const luna = "openai/gpt-6-luna";
    give(cardIn(deckId), "good", daysAgo(1), { suggested: "good" });
    give(cardIn(deckId), "easy", daysAgo(1), { suggested: "good" });
    give(cardIn(deckId), "again", daysAgo(1), { suggested: "hard" });
    give(cardIn(deckId), "good", daysAgo(1), { suggested: "good", model: luna });
    give(cardIn(deckId), "hard", daysAgo(1), { suggested: "easy", model: "gone/model" });
    give(cardIn(deckId), "good", daysAgo(1));
    // Out of the range.
    give(cardIn(deckId), "good", daysAgo(10), { suggested: "again" });
    expect(overall("7").graderAgreement).toEqual({
      kept: 2,
      higher: 1,
      lower: 2,
      models: [
        { model: HAIKU, kept: 1, higher: 1, lower: 1 },
        { model: "gone/model", kept: 0, higher: 0, lower: 1 },
        { model: luna, kept: 1, higher: 0, lower: 0 },
      ],
    });
  });

  test("is empty with no graded Reviews", () => {
    give(cardIn(deckNamed("Spanish")), "good", daysAgo(1));
    expect(overall().graderAgreement).toEqual({ kept: 0, higher: 0, lower: 0, models: [] });
  });
});

describe("Minutes per day", () => {
  test("sums durationMs per Study day over the range, zeros included", () => {
    const deckId = deckNamed("Spanish");
    give(cardIn(deckId), "good", daysAgo(6), { durationMs: 30_000 });
    give(cardIn(deckId), "good", daysAgo(6), { durationMs: 45_000 });
    give(cardIn(deckId), "good", daysAgo(0), { durationMs: 10_000 });
    give(cardIn(deckId), "good", daysAgo(9), { durationMs: 99_000 });
    expect(overall("7").minutes).toEqual({
      bucket: "day",
      points: [
        { start: "2026-11-07", ms: 75_000 },
        { start: "2026-11-08", ms: 0 },
        { start: "2026-11-09", ms: 0 },
        { start: "2026-11-10", ms: 0 },
        { start: "2026-11-11", ms: 0 },
        { start: "2026-11-12", ms: 0 },
        { start: "2026-11-13", ms: 10_000 },
      ],
    });
    expect(overall("90").minutes.points).toHaveLength(90);
  });

  test("All time stays daily up to 90 days", () => {
    give(cardIn(deckNamed("Spanish")), "good", daysAgo(89));
    const { minutes } = overall("all");
    expect(minutes.bucket).toBe("day");
    expect(minutes.points).toHaveLength(90);
  });

  test("All time over 90 days goes per week, from its first Monday", () => {
    const deckId = deckNamed("Spanish");
    // Wednesday 12 August 2026: 94 Study days ago, counting today.
    give(cardIn(deckId), "good", daysAgo(93), { durationMs: 1_000 });
    give(cardIn(deckId), "good", daysAgo(91), { durationMs: 2_000 });
    give(cardIn(deckId), "good", daysAgo(0), { durationMs: 4_000 });
    const { minutes, from } = overall("all");
    expect(from).toBe("2026-08-12");
    expect(minutes.bucket).toBe("week");
    expect(minutes.points[0]).toEqual({ start: "2026-08-10", ms: 3_000 });
    expect(minutes.points.at(-1)).toEqual({ start: "2026-11-09", ms: 4_000 });
    expect(minutes.points).toHaveLength(14);
    expect(minutes.points.every((p) => new Date(`${p.start}T00:00:00Z`).getUTCDay() === 1)).toBe(
      true,
    );
  });
});

describe("the activity calendar", () => {
  test("covers 53 weeks from a Monday, whatever the range", () => {
    const deckId = deckNamed("Spanish");
    // Monday 10 November 2025 is the calendar's first day; the Sunday before isn't in it.
    give(cardIn(deckId), "good", new Date("2025-11-09T12:00:00Z"));
    give(cardIn(deckId), "good", new Date("2025-11-10T12:00:00Z"));
    give(cardIn(deckId), "good", daysAgo(1));
    const stats = overall("7");
    expect(stats.calendar.map((d) => d.day)).toEqual(["2025-11-10", "2026-11-12"]);
    expect(overall("all").calendar).toEqual(stats.calendar);
  });
});
