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
const COMMITTED = ["0000_baseline", "0001_auth"];

/** The tables the committed migrations create. */
const COMMITTED_TABLES = ["auth_account", "auth_session", "auth_verification", "user"];

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
