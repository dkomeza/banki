import { afterEach, beforeEach, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { type OpenedDatabase, openDatabase } from "./database";
import { applyMigrations, migrationsFolder } from "./migrate";

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
