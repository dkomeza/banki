import { Database as SQLite } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { z } from "zod";
import { hasProgressResetSince } from "../repositories/progress-resets";
import { lastReviewOf } from "../repositories/reviews";
import { nextSeq } from "../repositories/write-order";
import { type OpenedDatabase, type Queryable, openDatabase } from "./database";
import { applyMigrations, migrationsFolder } from "./migrate";
import * as schema from "./schema";

let tempDir: string;
let folder: string;
let opened: OpenedDatabase;

/**
 * Adds a migration to the copied folder the way drizzle-kit would: a SQL file and a
 * journal entry, created a second after the last one unless `when` says otherwise.
 */
const addMigration = (tag: string, statements: string, when?: number): number => {
  writeFileSync(join(folder, `${tag}.sql`), statements);
  const journalPath = join(folder, "meta", "_journal.json");
  const journal = z
    .looseObject({ entries: z.array(z.looseObject({ when: z.number() })) })
    .parse(JSON.parse(readFileSync(journalPath, "utf8")));
  const created = when ?? (journal.entries.at(-1)?.when ?? 0) + 1000;
  journal.entries.push({
    idx: journal.entries.length,
    version: "6",
    when: created,
    tag,
    breakpoints: true,
  });
  writeFileSync(journalPath, JSON.stringify(journal));
  return created;
};

/** The committed migrations, in order. */
const COMMITTED = [
  "0000_baseline",
  "0001_auth",
  "0002_user_settings",
  "0003_grading",
  "0004_decks",
  "0005_folders",
  "0006_cards",
  "0007_deletions",
  "0008_tags",
  "0009_images",
  "0010_auto_close",
  "0011_scheduling",
  "0012_soft_cap",
  "0013_macros",
  "0014_grading_notes",
  "0015_progress_resets",
  "0016_session_timeout",
  "0017_answer_mode",
  "0018_imports",
  "0019_settings_answer_mode",
  "0020_graded_reviews",
  "0021_parameter_tuning",
  "0022_import_undo",
  "0023_plan",
  "0024_recommended_retention",
  "0025_deck_parameters",
];

/** The tables the committed migrations create. */
const COMMITTED_TABLES = [
  "auth_account",
  "auth_session",
  "auth_verification",
  "card",
  "card_tag",
  "deck",
  "folder",
  "image",
  "import",
  "parameter_tuning",
  "plan",
  "progress_reset",
  "review",
  "user",
  "user_settings",
];

/** The tables migrations created, leaving out SQLite's and Drizzle's own. */
const tables = () =>
  opened.db
    .values<[string]>(
      sql`SELECT name FROM sqlite_master WHERE type = 'table'
          AND name NOT LIKE 'sqlite_%' AND name != '__drizzle_migrations' ORDER BY name`,
    )
    .map(([name]) => name);

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "banki-migrate-"));
  folder = join(tempDir, "drizzle");
  cpSync(migrationsFolder, folder, { recursive: true });
  opened = openDatabase(join(tempDir, "data"));
});

afterEach(() => {
  opened.close();
  rmSync(tempDir, { recursive: true, force: true });
});

test("a restart applies only the migrations added since the last boot", () => {
  expect(applyMigrations(opened.db, folder)).toEqual(COMMITTED);

  addMigration("0100_note", "CREATE TABLE note (id integer PRIMARY KEY);");

  expect(applyMigrations(opened.db, folder)).toEqual(["0100_note"]);
  expect(tables()).toEqual([...COMMITTED_TABLES, "note"].toSorted());
  expect(applyMigrations(opened.db, folder)).toEqual([]);
});

test("a failing migration applies nothing and throws", () => {
  addMigration("0100_note", "CREATE TABLE note (id integer PRIMARY KEY);");
  addMigration("0101_broken", "THIS IS NOT SQL;");

  expect(() => applyMigrations(opened.db, folder)).toThrow();
  expect(tables()).toEqual([]);

  // Once the broken migration is fixed, every one of them is still pending.
  writeFileSync(join(folder, "0101_broken.sql"), "SELECT 1;");
  expect(applyMigrations(opened.db, folder)).toEqual([...COMMITTED, "0100_note", "0101_broken"]);
});

test("a migration older than the latest applied one fails startup before anything is applied", () => {
  const later = addMigration("0102_later", "SELECT 1;");
  applyMigrations(opened.db, folder);
  const before = tables();

  // A merge after 0102 was applied brings a migration generated before it (0101)
  // alongside a newer one (0103) that would otherwise be applied.
  addMigration("0101_note", "CREATE TABLE note (id integer PRIMARY KEY);", later - 500);
  addMigration("0103_tag", "CREATE TABLE tag (id integer PRIMARY KEY);", later + 1000);

  expect(() => applyMigrations(opened.db, folder)).toThrow(
    /0101_note.*older than the latest applied migration/s,
  );
  expect(tables()).toEqual(before);
});

test("0011_scheduling keeps every Deck and Card, as new Cards following Settings", () => {
  // The database as the release before it left it: this migration and later ones not applied.
  const journalPath = join(folder, "meta", "_journal.json");
  const full = readFileSync(journalPath, "utf8");
  const journal = z
    .looseObject({ entries: z.array(z.looseObject({ tag: z.string() })) })
    .parse(JSON.parse(full));
  writeFileSync(
    journalPath,
    JSON.stringify({
      ...journal,
      entries: journal.entries.filter((entry) => entry.tag < "0011_scheduling"),
    }),
  );
  applyMigrations(opened.db, folder);
  opened.db.run(
    sql`INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES ('u', 'n', 'u@x.y', 1, 0, 0)`,
  );
  opened.db.run(sql`INSERT INTO user_settings (user_id, timezone) VALUES ('u', 'UTC')`);
  opened.db.run(
    sql`INSERT INTO deck (id, user_id, name, name_key, created_at, updated_at) VALUES ('d', 'u', 'D', 'd', 0, 0)`,
  );
  opened.db.run(
    sql`INSERT INTO card (id, user_id, deck_id, front, back, created_at, updated_at) VALUES ('c', 'u', 'd', 'f', 'b', 0, 0)`,
  );

  writeFileSync(journalPath, full);
  expect(applyMigrations(opened.db, folder)).toEqual(
    COMMITTED.slice(COMMITTED.indexOf("0011_scheduling")),
  );

  expect(opened.db.values(sql`SELECT id, desired_retention FROM deck`)).toEqual([["d", null]]);
  expect(opened.db.values(sql`SELECT id, state, due_at, reps FROM card`)).toEqual([
    ["c", "new", null, 0],
  ]);
  expect(opened.db.values(sql`SELECT desired_retention FROM user_settings`)).toEqual([[90]]);
  // The new columns refuse what is out of range.
  expect(() => opened.db.run(sql`UPDATE deck SET desired_retention = 98`)).toThrow();
  expect(() => opened.db.run(sql`UPDATE user_settings SET desired_retention = 69`)).toThrow();
});

test("0012_soft_cap keeps every row of Settings, with the default New-card batch and Learning limit", () => {
  // The database as the release before it left it: this migration and later ones not applied.
  const journalPath = join(folder, "meta", "_journal.json");
  const full = readFileSync(journalPath, "utf8");
  const journal = z
    .looseObject({ entries: z.array(z.looseObject({ tag: z.string() })) })
    .parse(JSON.parse(full));
  writeFileSync(
    journalPath,
    JSON.stringify({
      ...journal,
      entries: journal.entries.filter((entry) => entry.tag < "0012_soft_cap"),
    }),
  );
  applyMigrations(opened.db, folder);
  opened.db.run(
    sql`INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES ('u', 'n', 'u@x.y', 1, 0, 0)`,
  );
  opened.db.run(
    sql`INSERT INTO user_settings (user_id, timezone, desired_retention) VALUES ('u', 'UTC', 85)`,
  );
  opened.db.run(
    sql`INSERT INTO deck (id, user_id, name, name_key, created_at, updated_at) VALUES ('d', 'u', 'D', 'd', 0, 0)`,
  );
  opened.db.run(
    sql`INSERT INTO card (id, user_id, deck_id, front, back, created_at, updated_at) VALUES ('c', 'u', 'd', 'f', 'b', 0, 0)`,
  );

  writeFileSync(journalPath, full);
  expect(applyMigrations(opened.db, folder)).toEqual(
    COMMITTED.slice(COMMITTED.indexOf("0012_soft_cap")),
  );

  expect(
    opened.db.values(
      sql`SELECT user_id, timezone, desired_retention, new_card_batch, learning_limit FROM user_settings`,
    ),
  ).toEqual([["u", "UTC", 85, 20, 10]]);
  expect(opened.db.values(sql`SELECT id FROM card`)).toEqual([["c"]]);
  // The new columns refuse what is out of range.
  for (const bad of [
    sql`UPDATE user_settings SET new_card_batch = 4`,
    sql`UPDATE user_settings SET new_card_batch = 101`,
    sql`UPDATE user_settings SET learning_limit = 4`,
    sql`UPDATE user_settings SET learning_limit = 51`,
  ]) {
    expect(() => opened.db.run(bad)).toThrow();
  }
});

test("0013_macros keeps every Deck and Settings row, each with no Macros", () => {
  // The database as the release before it left it: this migration and later ones not applied.
  const journalPath = join(folder, "meta", "_journal.json");
  const full = readFileSync(journalPath, "utf8");
  const journal = z
    .looseObject({ entries: z.array(z.looseObject({ tag: z.string() })) })
    .parse(JSON.parse(full));
  writeFileSync(
    journalPath,
    JSON.stringify({
      ...journal,
      entries: journal.entries.filter((entry) => entry.tag < "0013_macros"),
    }),
  );
  applyMigrations(opened.db, folder);
  opened.db.run(
    sql`INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES ('u', 'n', 'u@x.y', 1, 0, 0)`,
  );
  opened.db.run(sql`INSERT INTO user_settings (user_id, timezone) VALUES ('u', 'UTC')`);
  opened.db.run(
    sql`INSERT INTO deck (id, user_id, name, name_key, created_at, updated_at) VALUES ('d', 'u', 'D', 'd', 0, 0)`,
  );
  opened.db.run(
    sql`INSERT INTO card (id, user_id, deck_id, front, back, created_at, updated_at) VALUES ('c', 'u', 'd', 'f', 'b', 0, 0)`,
  );

  writeFileSync(journalPath, full);
  expect(applyMigrations(opened.db, folder)).toEqual(
    COMMITTED.slice(COMMITTED.indexOf("0013_macros")),
  );

  expect(opened.db.values(sql`SELECT id, macros FROM deck`)).toEqual([["d", "[]"]]);
  expect(opened.db.values(sql`SELECT id FROM card`)).toEqual([["c"]]);
  expect(opened.db.values(sql`SELECT timezone, macros FROM user_settings`)).toEqual([
    ["UTC", "[]"],
  ]);
});

test("0014_grading_notes keeps every Card, with no Grading notes", () => {
  // The database as the release before it left it: this migration and later ones not applied.
  const journalPath = join(folder, "meta", "_journal.json");
  const full = readFileSync(journalPath, "utf8");
  const journal = z
    .looseObject({ entries: z.array(z.looseObject({ tag: z.string() })) })
    .parse(JSON.parse(full));
  writeFileSync(
    journalPath,
    JSON.stringify({
      ...journal,
      entries: journal.entries.filter((entry) => entry.tag < "0014_grading_notes"),
    }),
  );
  applyMigrations(opened.db, folder);
  opened.db.run(
    sql`INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES ('u', 'n', 'u@x.y', 1, 0, 0)`,
  );
  opened.db.run(
    sql`INSERT INTO deck (id, user_id, name, name_key, created_at, updated_at) VALUES ('d', 'u', 'D', 'd', 0, 0)`,
  );
  opened.db.run(
    sql`INSERT INTO card (id, user_id, deck_id, front, back, created_at, updated_at) VALUES ('c', 'u', 'd', 'f', 'b', 0, 0)`,
  );

  writeFileSync(journalPath, full);
  expect(applyMigrations(opened.db, folder)).toEqual(
    COMMITTED.slice(COMMITTED.indexOf("0014_grading_notes")),
  );

  expect(opened.db.values(sql`SELECT id, front, back, grading_notes FROM card`)).toEqual([
    ["c", "f", "b", null],
  ]);
});

test("0015_progress_resets keeps every Card and Review, numbered in order for each User, with no Progress reset", () => {
  const journalPath = join(folder, "meta", "_journal.json");
  const full = readFileSync(journalPath, "utf8");
  const journal = z
    .looseObject({ entries: z.array(z.looseObject({ tag: z.string() })) })
    .parse(JSON.parse(full));
  writeFileSync(
    journalPath,
    JSON.stringify({
      ...journal,
      entries: journal.entries.filter((entry) => entry.tag < "0015_progress_resets"),
    }),
  );
  applyMigrations(opened.db, folder);
  opened.db.run(
    sql`INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES ('u', 'n', 'u@x.y', 1, 0, 0)`,
  );
  opened.db.run(
    sql`INSERT INTO deck (id, user_id, name, name_key, created_at, updated_at) VALUES ('d', 'u', 'D', 'd', 0, 0)`,
  );
  opened.db.run(
    sql`INSERT INTO card (id, user_id, deck_id, front, back, created_at, updated_at, state) VALUES ('c', 'u', 'd', 'f', 'b', 0, 0, 'review')`,
  );
  // Another User, whose Reviews are numbered on their own, from 1.
  opened.db.run(
    sql`INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES ('v', 'n', 'v@x.y', 1, 0, 0)`,
  );
  opened.db.run(
    sql`INSERT INTO deck (id, user_id, name, name_key, created_at, updated_at) VALUES ('e', 'v', 'E', 'e', 0, 0)`,
  );
  opened.db.run(
    sql`INSERT INTO card (id, user_id, deck_id, front, back, created_at, updated_at, state) VALUES ('k', 'v', 'e', 'f', 'b', 0, 0, 'review')`,
  );
  opened.db.run(
    sql`INSERT INTO review (id, user_id, card_id, deck_id, reviewed_at, rating, kind, duration_ms, card_before) VALUES ('v0', 'v', 'k', 'e', 0, 'good', 'self-rated', 0, '{}')`,
  );
  opened.db.run(
    sql`INSERT INTO review (id, user_id, card_id, deck_id, reviewed_at, rating, kind, duration_ms, card_before) VALUES ('r', 'u', 'c', 'd', 0, 'good', 'self-rated', 0, '{}')`,
  );
  // Written later at an earlier moment, and at the same moment, as far as rowid tells.
  opened.db.run(
    sql`INSERT INTO review (id, user_id, card_id, deck_id, reviewed_at, rating, kind, duration_ms, card_before) VALUES ('r0', 'u', 'c', 'd', -1, 'good', 'self-rated', 0, '{}')`,
  );
  opened.db.run(
    sql`INSERT INTO review (id, user_id, card_id, deck_id, reviewed_at, rating, kind, duration_ms, card_before) VALUES ('r1', 'u', 'c', 'd', 0, 'good', 'self-rated', 0, '{}')`,
  );
  opened.db.run(
    sql`INSERT INTO review (id, user_id, card_id, deck_id, reviewed_at, rating, kind, duration_ms, card_before) VALUES ('v1', 'v', 'k', 'e', 1, 'good', 'self-rated', 0, '{}')`,
  );

  writeFileSync(journalPath, full);
  expect(applyMigrations(opened.db, folder)).toEqual(
    COMMITTED.slice(COMMITTED.indexOf("0015_progress_resets")),
  );

  expect(opened.db.values(sql`SELECT id, state FROM card ORDER BY id`)).toEqual([
    ["c", "review"],
    ["k", "review"],
  ]);
  expect(opened.db.values(sql`SELECT user_id, id, seq FROM review ORDER BY user_id, seq`)).toEqual([
    ["u", "r0", 1],
    ["u", "r", 2],
    ["u", "r1", 3],
    ["v", "v0", 1],
    ["v", "v1", 2],
  ]);
  expect(opened.db.values(sql`SELECT id FROM progress_reset`)).toEqual([]);
});

test("0016_session_timeout keeps every row of Settings with the default Session timeout, and caps every Review at 2 minutes", () => {
  // The database as the release before it left it: this migration and later ones not applied.
  const journalPath = join(folder, "meta", "_journal.json");
  const full = readFileSync(journalPath, "utf8");
  const journal = z
    .looseObject({ entries: z.array(z.looseObject({ tag: z.string() })) })
    .parse(JSON.parse(full));
  writeFileSync(
    journalPath,
    JSON.stringify({
      ...journal,
      entries: journal.entries.filter((entry) => entry.tag < "0016_session_timeout"),
    }),
  );
  applyMigrations(opened.db, folder);
  opened.db.run(
    sql`INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES ('u', 'n', 'u@x.y', 1, 0, 0)`,
  );
  opened.db.run(
    sql`INSERT INTO user_settings (user_id, timezone, learning_limit) VALUES ('u', 'UTC', 15)`,
  );
  opened.db.run(
    sql`INSERT INTO deck (id, user_id, name, name_key, created_at, updated_at) VALUES ('d', 'u', 'D', 'd', 0, 0)`,
  );
  opened.db.run(
    sql`INSERT INTO card (id, user_id, deck_id, front, back, created_at, updated_at) VALUES ('c', 'u', 'd', 'f', 'b', 0, 0)`,
  );
  for (const [id, seq, durationMs] of [
    ["short", 1, 4200],
    ["cap", 2, 120_000],
    ["long", 3, 600_000],
  ] as const) {
    opened.db.run(
      sql`INSERT INTO review (id, user_id, card_id, deck_id, reviewed_at, rating, kind, duration_ms, card_before, seq) VALUES (${id}, 'u', 'c', 'd', 0, 'good', 'self-rated', ${durationMs}, '{}', ${seq})`,
    );
  }

  writeFileSync(journalPath, full);
  expect(applyMigrations(opened.db, folder)).toEqual(
    COMMITTED.slice(COMMITTED.indexOf("0016_session_timeout")),
  );

  expect(
    opened.db.values(
      sql`SELECT user_id, timezone, learning_limit, session_timeout_minutes FROM user_settings`,
    ),
  ).toEqual([["u", "UTC", 15, 30]]);
  expect(opened.db.values(sql`SELECT id FROM card`)).toEqual([["c"]]);
  expect(opened.db.values(sql`SELECT id, duration_ms FROM review ORDER BY seq`)).toEqual([
    ["short", 4200],
    ["cap", 120_000],
    ["long", 120_000],
  ]);
  // The new column refuses what is out of range.
  for (const bad of [
    sql`UPDATE user_settings SET session_timeout_minutes = 4`,
    sql`UPDATE user_settings SET session_timeout_minutes = 241`,
  ]) {
    expect(() => opened.db.run(bad)).toThrow();
  }
});

test("0017_answer_mode keeps every Deck and Card, each Deck following Settings", () => {
  // The database as the release before it left it: this migration and later ones not applied.
  const journalPath = join(folder, "meta", "_journal.json");
  const full = readFileSync(journalPath, "utf8");
  const journal = z
    .looseObject({ entries: z.array(z.looseObject({ tag: z.string() })) })
    .parse(JSON.parse(full));
  writeFileSync(
    journalPath,
    JSON.stringify({
      ...journal,
      entries: journal.entries.filter((entry) => entry.tag < "0017_answer_mode"),
    }),
  );
  applyMigrations(opened.db, folder);
  opened.db.run(
    sql`INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES ('u', 'n', 'u@x.y', 1, 0, 0)`,
  );
  opened.db.run(
    sql`INSERT INTO deck (id, user_id, name, name_key, created_at, updated_at, desired_retention) VALUES ('d', 'u', 'D', 'd', 0, 0, 85)`,
  );
  opened.db.run(
    sql`INSERT INTO card (id, user_id, deck_id, front, back, created_at, updated_at) VALUES ('c', 'u', 'd', 'f', 'b', 0, 0)`,
  );

  writeFileSync(journalPath, full);
  expect(applyMigrations(opened.db, folder)).toEqual(
    COMMITTED.slice(COMMITTED.indexOf("0017_answer_mode")),
  );

  expect(opened.db.values(sql`SELECT id, desired_retention, answer_mode FROM deck`)).toEqual([
    ["d", 85, null],
  ]);
  expect(opened.db.values(sql`SELECT id FROM card`)).toEqual([["c"]]);
  // The new column takes a mode, and refuses anything else.
  opened.db.run(sql`UPDATE deck SET answer_mode = 'write'`);
  opened.db.run(sql`UPDATE deck SET answer_mode = 'self-rate'`);
  expect(() => opened.db.run(sql`UPDATE deck SET answer_mode = 'grade'`)).toThrow();
});

test("0018_imports keeps every Card, from no Import, and an Import's removal leaves its Cards", () => {
  const journalPath = join(folder, "meta", "_journal.json");
  const full = readFileSync(journalPath, "utf8");
  const journal = z
    .looseObject({ entries: z.array(z.looseObject({ tag: z.string() })) })
    .parse(JSON.parse(full));
  writeFileSync(
    journalPath,
    JSON.stringify({
      ...journal,
      entries: journal.entries.filter((entry) => entry.tag < "0018_imports"),
    }),
  );
  applyMigrations(opened.db, folder);
  opened.db.run(
    sql`INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES ('u', 'n', 'u@x.y', 1, 0, 0)`,
  );
  opened.db.run(
    sql`INSERT INTO deck (id, user_id, name, name_key, created_at, updated_at) VALUES ('d', 'u', 'D', 'd', 0, 0)`,
  );
  opened.db.run(
    sql`INSERT INTO card (id, user_id, deck_id, front, back, created_at, updated_at) VALUES ('c', 'u', 'd', 'f', 'b', 0, 0)`,
  );

  writeFileSync(journalPath, full);
  expect(applyMigrations(opened.db, folder)).toEqual(
    COMMITTED.slice(COMMITTED.indexOf("0018_imports")),
  );
  expect(opened.db.values(sql`SELECT id, import_id FROM card`)).toEqual([["c", null]]);

  opened.db.run(
    sql`INSERT INTO import (id, user_id, deck_id, file_name, source, created_at) VALUES ('i', 'u', 'd', 'f.json', 'json', 0)`,
  );
  opened.db.run(sql`UPDATE card SET import_id = 'i'`);
  expect(() => opened.db.run(sql`UPDATE import SET source = 'csv'`)).toThrow();
  // Removing an Import leaves its Cards, from no Import.
  opened.db.run(sql`DELETE FROM import`);
  expect(opened.db.values(sql`SELECT id, import_id FROM card`)).toEqual([["c", null]]);
});

test("0019_settings_answer_mode keeps every row of Settings, each in self-rate, and every Deck and Card", () => {
  // The database as the release before it left it: this migration and later ones not applied.
  const journalPath = join(folder, "meta", "_journal.json");
  const full = readFileSync(journalPath, "utf8");
  const journal = z
    .looseObject({ entries: z.array(z.looseObject({ tag: z.string() })) })
    .parse(JSON.parse(full));
  writeFileSync(
    journalPath,
    JSON.stringify({
      ...journal,
      entries: journal.entries.filter((entry) => entry.tag < "0019_settings_answer_mode"),
    }),
  );
  applyMigrations(opened.db, folder);
  opened.db.run(
    sql`INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES ('u', 'n', 'u@x.y', 1, 0, 0)`,
  );
  opened.db.run(
    sql`INSERT INTO user_settings (user_id, timezone, desired_retention) VALUES ('u', 'UTC', 85)`,
  );
  opened.db.run(
    sql`INSERT INTO deck (id, user_id, name, name_key, created_at, updated_at, answer_mode) VALUES ('d', 'u', 'D', 'd', 0, 0, 'write')`,
  );
  opened.db.run(
    sql`INSERT INTO card (id, user_id, deck_id, front, back, created_at, updated_at) VALUES ('c', 'u', 'd', 'f', 'b', 0, 0)`,
  );

  writeFileSync(journalPath, full);
  expect(applyMigrations(opened.db, folder)).toEqual(
    COMMITTED.slice(COMMITTED.indexOf("0019_settings_answer_mode")),
  );

  expect(
    opened.db.values(
      sql`SELECT user_id, timezone, desired_retention, answer_mode FROM user_settings`,
    ),
  ).toEqual([["u", "UTC", 85, "self-rate"]]);
  expect(opened.db.values(sql`SELECT id, answer_mode FROM deck`)).toEqual([["d", "write"]]);
  expect(opened.db.values(sql`SELECT id FROM card`)).toEqual([["c"]]);
  // The new column takes a mode, and refuses anything else.
  opened.db.run(sql`UPDATE user_settings SET answer_mode = 'write'`);
  expect(() => opened.db.run(sql`UPDATE user_settings SET answer_mode = 'grade'`)).toThrow();
  expect(() => opened.db.run(sql`UPDATE user_settings SET answer_mode = NULL`)).toThrow();
});

test("0020_graded_reviews keeps every Review, self-rated with no suggestion, and holds a graded one to both", () => {
  const journalPath = join(folder, "meta", "_journal.json");
  const full = readFileSync(journalPath, "utf8");
  const journal = z
    .looseObject({ entries: z.array(z.looseObject({ tag: z.string() })) })
    .parse(JSON.parse(full));
  writeFileSync(
    journalPath,
    JSON.stringify({
      ...journal,
      entries: journal.entries.filter((entry) => entry.tag < "0020_graded_reviews"),
    }),
  );
  applyMigrations(opened.db, folder);
  opened.db.run(
    sql`INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES ('u', 'n', 'u@x.y', 1, 0, 0)`,
  );
  opened.db.run(
    sql`INSERT INTO deck (id, user_id, name, name_key, created_at, updated_at) VALUES ('d', 'u', 'D', 'd', 0, 0)`,
  );
  opened.db.run(
    sql`INSERT INTO card (id, user_id, deck_id, front, back, created_at, updated_at, state) VALUES ('c', 'u', 'd', 'f', 'b', 0, 0, 'review')`,
  );
  opened.db.run(
    sql`INSERT INTO review (id, user_id, card_id, deck_id, reviewed_at, rating, kind, duration_ms, card_before, seq) VALUES ('r', 'u', 'c', 'd', 0, 'good', 'self-rated', 0, '{}', 1)`,
  );

  writeFileSync(journalPath, full);
  expect(applyMigrations(opened.db, folder)).toEqual(
    COMMITTED.slice(COMMITTED.indexOf("0020_graded_reviews")),
  );
  expect(opened.db.values(sql`SELECT id, kind, suggested_rating, model FROM review`)).toEqual([
    ["r", "self-rated", null, null],
  ]);
  expect(opened.db.values(sql`SELECT id FROM card`)).toEqual([["c"]]);

  const insert = (
    id: string,
    seq: number,
    kind: string,
    suggested: string | null,
    model: string | null,
  ) =>
    opened.db.run(
      sql`INSERT INTO review (id, user_id, card_id, deck_id, reviewed_at, rating, kind, suggested_rating, model, duration_ms, card_before, seq) VALUES (${id}, 'u', 'c', 'd', 0, 'good', ${kind}, ${suggested}, ${model}, 0, '{}', ${seq})`,
    );
  insert("g", 2, "graded", "hard", "anthropic/claude-haiku-5.5");
  // The CHECK refuses a graded Review missing either, and a self-rated one with either.
  expect(() => insert("x1", 3, "graded", null, null)).toThrow();
  expect(() => insert("x2", 4, "graded", "hard", null)).toThrow();
  expect(() => insert("x3", 5, "graded", null, "anthropic/claude-haiku-5.5")).toThrow();
  expect(() => insert("x4", 6, "self-rated", "hard", "anthropic/claude-haiku-5.5")).toThrow();
  expect(() => insert("x5", 7, "self-rated", "hard", null)).toThrow();
  expect(() => insert("x6", 8, "self-rated", null, "anthropic/claude-haiku-5.5")).toThrow();
  expect(opened.db.values(sql`SELECT id FROM review ORDER BY seq`)).toEqual([["r"], ["g"]]);
});

test("0021_parameter_tuning keeps every row of Settings, on FSRS's defaults, and logs no Tuning", () => {
  const journalPath = join(folder, "meta", "_journal.json");
  const full = readFileSync(journalPath, "utf8");
  const journal = z
    .looseObject({ entries: z.array(z.looseObject({ tag: z.string() })) })
    .parse(JSON.parse(full));
  writeFileSync(
    journalPath,
    JSON.stringify({
      ...journal,
      entries: journal.entries.filter((entry) => entry.tag < "0021_parameter_tuning"),
    }),
  );
  applyMigrations(opened.db, folder);
  opened.db.run(
    sql`INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES ('u', 'n', 'u@x.y', 1, 0, 0)`,
  );
  opened.db.run(sql`INSERT INTO user_settings (user_id, desired_retention) VALUES ('u', 85)`);

  writeFileSync(journalPath, full);
  expect(applyMigrations(opened.db, folder)).toEqual(
    COMMITTED.slice(COMMITTED.indexOf("0021_parameter_tuning")),
  );

  expect(
    opened.db.values(sql`SELECT user_id, desired_retention, fsrs_parameters FROM user_settings`),
  ).toEqual([["u", 85, null]]);
  expect(opened.db.values(sql`SELECT id FROM parameter_tuning`)).toEqual([]);
  // A log row takes a trigger and an outcome Banki knows, and refuses others.
  const row = (trigger: string, outcome: string) =>
    opened.db.run(
      sql`INSERT INTO parameter_tuning (id, user_id, ran_at, trigger, review_count, outcome) VALUES (${`${trigger}-${outcome}`}, 'u', 0, ${trigger}, 0, ${outcome})`,
    );
  row("automatic", "applied");
  row("reset", "reset");
  expect(() => row("cron", "applied")).toThrow();
  expect(() => row("manual", "skipped")).toThrow();
  // A User's removal takes their log with them.
  opened.db.run(sql`DELETE FROM user`);
  expect(opened.db.values(sql`SELECT id FROM parameter_tuning`)).toEqual([]);
});

test("0022_import_undo keeps every Import, none of them undone, and finds an Undo's Import through an index", () => {
  const journalPath = join(folder, "meta", "_journal.json");
  const full = readFileSync(journalPath, "utf8");
  const journal = z
    .looseObject({ entries: z.array(z.looseObject({ tag: z.string() })) })
    .parse(JSON.parse(full));
  writeFileSync(
    journalPath,
    JSON.stringify({
      ...journal,
      entries: journal.entries.filter((entry) => entry.tag < "0022_import_undo"),
    }),
  );
  applyMigrations(opened.db, folder);
  opened.db.run(
    sql`INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES ('u', 'n', 'u@x.y', 1, 0, 0)`,
  );
  opened.db.run(
    sql`INSERT INTO deck (id, user_id, name, name_key, created_at, updated_at) VALUES ('d', 'u', 'D', 'd', 0, 0)`,
  );
  opened.db.run(
    sql`INSERT INTO import (id, user_id, deck_id, file_name, source, created_at, confirmed_at) VALUES ('i', 'u', 'd', 'f.json', 'json', 0, 1)`,
  );

  writeFileSync(journalPath, full);
  expect(applyMigrations(opened.db, folder)).toEqual(
    COMMITTED.slice(COMMITTED.indexOf("0022_import_undo")),
  );
  expect(
    opened.db.values(sql`SELECT id, confirmed_at, undone_at, undo_deletion_id FROM import`),
  ).toEqual([["i", 1, null, null]]);
  const plan = opened.db.values(
    sql`EXPLAIN QUERY PLAN SELECT id FROM import WHERE user_id = 'u' AND undo_deletion_id = 'x'`,
  );
  expect(JSON.stringify(plan)).toContain("import_undo_deletion_id");
});

test("0023_plan keeps every Deck and Card, with no Plan, and a Deck's Removal takes its Plan", () => {
  const journalPath = join(folder, "meta", "_journal.json");
  const full = readFileSync(journalPath, "utf8");
  const journal = z
    .looseObject({ entries: z.array(z.looseObject({ tag: z.string() })) })
    .parse(JSON.parse(full));
  writeFileSync(
    journalPath,
    JSON.stringify({
      ...journal,
      entries: journal.entries.filter((entry) => entry.tag < "0023_plan"),
    }),
  );
  applyMigrations(opened.db, folder);
  opened.db.run(
    sql`INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES ('u', 'n', 'u@x.y', 1, 0, 0)`,
  );
  opened.db.run(
    sql`INSERT INTO deck (id, user_id, name, name_key, created_at, updated_at, desired_retention) VALUES ('d', 'u', 'D', 'd', 0, 0, 85)`,
  );
  opened.db.run(
    sql`INSERT INTO card (id, user_id, deck_id, front, back, created_at, updated_at) VALUES ('c', 'u', 'd', 'f', 'b', 0, 0)`,
  );

  writeFileSync(journalPath, full);
  expect(applyMigrations(opened.db, folder)).toEqual(
    COMMITTED.slice(COMMITTED.indexOf("0023_plan")),
  );

  expect(opened.db.values(sql`SELECT id, desired_retention FROM deck`)).toEqual([["d", 85]]);
  expect(opened.db.values(sql`SELECT id FROM card`)).toEqual([["c"]]);
  expect(opened.db.values(sql`SELECT id FROM plan`)).toEqual([]);
  const plan = (id: string, minutes: number) =>
    opened.db.run(
      sql`INSERT INTO plan (id, user_id, deck_id, deadline, daily_minutes, created_at, updated_at) VALUES (${id}, 'u', 'd', '2026-12-12', ${minutes}, 0, 0)`,
    );
  // Whole minutes from 5 to 600, and one Plan a Deck.
  expect(() => plan("p0", 4)).toThrow();
  expect(() => plan("p0", 601)).toThrow();
  plan("p1", 30);
  expect(() => plan("p2", 30)).toThrow();
  // A Deck's Removal takes its Plan with it.
  opened.db.run(sql`DELETE FROM card`);
  opened.db.run(sql`DELETE FROM deck`);
  expect(opened.db.values(sql`SELECT id FROM plan`)).toEqual([]);
});

test("0024_recommended_retention keeps every Tuning log row, with no Recommended retention", () => {
  const journalPath = join(folder, "meta", "_journal.json");
  const full = readFileSync(journalPath, "utf8");
  const journal = z
    .looseObject({ entries: z.array(z.looseObject({ tag: z.string() })) })
    .parse(JSON.parse(full));
  writeFileSync(
    journalPath,
    JSON.stringify({
      ...journal,
      entries: journal.entries.filter((entry) => entry.tag < "0024_recommended_retention"),
    }),
  );
  applyMigrations(opened.db, folder);
  opened.db.run(
    sql`INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES ('u', 'n', 'u@x.y', 1, 0, 0)`,
  );
  opened.db.run(
    sql`INSERT INTO parameter_tuning (id, user_id, ran_at, trigger, review_count, outcome, parameters) VALUES ('t', 'u', 0, 'automatic', 200, 'applied', '[1]')`,
  );

  writeFileSync(journalPath, full);
  expect(applyMigrations(opened.db, folder)).toEqual([
    "0024_recommended_retention",
    "0025_deck_parameters",
  ]);

  expect(
    opened.db.values(
      sql`SELECT id, outcome, parameters, recommended_retention FROM parameter_tuning`,
    ),
  ).toEqual([["t", "applied", "[1]", null]]);
});

test("0025_deck_parameters keeps every Deck following the overall Parameters and every Tuning log row overall, and a Deck's rows go with its Removal", () => {
  const journalPath = join(folder, "meta", "_journal.json");
  const full = readFileSync(journalPath, "utf8");
  const journal = z
    .looseObject({ entries: z.array(z.looseObject({ tag: z.string() })) })
    .parse(JSON.parse(full));
  writeFileSync(
    journalPath,
    JSON.stringify({
      ...journal,
      entries: journal.entries.filter((entry) => entry.tag < "0025_deck_parameters"),
    }),
  );
  applyMigrations(opened.db, folder);
  opened.db.run(
    sql`INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES ('u', 'n', 'u@x.y', 1, 0, 0)`,
  );
  opened.db.run(
    sql`INSERT INTO deck (id, user_id, name, name_key, created_at, updated_at) VALUES ('d', 'u', 'D', 'd', 0, 0)`,
  );
  opened.db.run(
    sql`INSERT INTO parameter_tuning (id, user_id, ran_at, trigger, review_count, outcome) VALUES ('t', 'u', 0, 'automatic', 200, 'kept')`,
  );

  writeFileSync(journalPath, full);
  expect(applyMigrations(opened.db, folder)).toEqual(["0025_deck_parameters"]);

  expect(opened.db.values(sql`SELECT id, fsrs_parameters FROM deck`)).toEqual([["d", null]]);
  expect(opened.db.values(sql`SELECT id, deck_id FROM parameter_tuning`)).toEqual([["t", null]]);
  opened.db.run(
    sql`INSERT INTO parameter_tuning (id, user_id, ran_at, trigger, review_count, outcome, deck_id) VALUES ('t2', 'u', 0, 'automatic', 1000, 'kept', 'd')`,
  );
  opened.db.run(sql`DELETE FROM deck`);
  expect(opened.db.values(sql`SELECT id FROM parameter_tuning`)).toEqual([["t"]]);
});

test("a Card's newest Review, its Progress resets since and the next place in the Write order are found through an index, not the User's whole history", () => {
  applyMigrations(opened.db, folder);
  // The SQL each one builds, as it runs, planned with its own parameters.
  const queries: { query: string; params: unknown[] }[] = [];
  const client = new SQLite(join(tempDir, "data", "banki.db"));
  const logged = drizzle({
    client,
    schema,
    logger: { logQuery: (query, params) => queries.push({ query, params }) },
  });
  const plansOf = (run: (db: Queryable) => unknown) => {
    queries.length = 0;
    run(logged);
    return queries.map(({ query, params }) => {
      const [first = "", ...rest] = query.split("?");
      const bound = sql.join([
        sql.raw(`EXPLAIN QUERY PLAN ${first}`),
        ...rest.flatMap((part, i) => [sql`${params[i]}`, sql.raw(part)]),
      ]);
      return opened.db
        .values<[number, number, number, string]>(bound)
        .map(([, , , detail]) => detail);
    });
  };

  expect(plansOf((db) => lastReviewOf(db, "u", "c"))).toEqual([
    ["SEARCH review USING INDEX review_card_id_user_id_seq (card_id=? AND user_id=?)"],
  ]);
  // Undo's check for a Progress reset since.
  expect(plansOf((db) => hasProgressResetSince(db, "u", "c", 1))).toEqual([
    [
      "SEARCH progress_reset USING INDEX progress_reset_card_id_user_id_seq (card_id=? AND user_id=? AND seq>?)",
    ],
  ]);
  expect(plansOf((db) => nextSeq(db, "u"))).toEqual([
    ["SEARCH review USING COVERING INDEX review_user_id_seq (user_id=?)"],
    ["SEARCH progress_reset USING COVERING INDEX progress_reset_user_id_seq (user_id=?)"],
  ]);
  client.close();
});

test("0015 leaves the review table only the indexes a query uses", () => {
  applyMigrations(opened.db, folder);

  expect(
    opened.db.values(
      sql`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'review' AND sql IS NOT NULL ORDER BY name`,
    ),
  ).toEqual([["review_card_id_user_id_seq"], ["review_deck_id"], ["review_user_id_seq"]]);
});
