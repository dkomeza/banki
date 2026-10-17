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

/** Adds a migration to the copied folder the way drizzle-kit would: a SQL file and a journal entry. */
const addMigration = (tag: string, statements: string) => {
  writeFileSync(join(folder, `${tag}.sql`), statements);
  const journalPath = join(folder, "meta", "_journal.json");
  const journal = z
    .looseObject({ entries: z.array(z.looseObject({ when: z.number() })) })
    .parse(JSON.parse(readFileSync(journalPath, "utf8")));
  const last = journal.entries.at(-1);
  journal.entries.push({
    idx: journal.entries.length,
    version: "6",
    when: (last?.when ?? 0) + 1000,
    tag,
    breakpoints: true,
  });
  writeFileSync(journalPath, JSON.stringify(journal));
};

const tables = () =>
  opened.db
    .values<[string]>(sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'note'`)
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
  expect(applyMigrations(opened.db, folder)).toEqual(["0000_baseline"]);

  addMigration("0001_note", "CREATE TABLE note (id integer PRIMARY KEY);");

  expect(applyMigrations(opened.db, folder)).toEqual(["0001_note"]);
  expect(tables()).toEqual(["note"]);
  expect(applyMigrations(opened.db, folder)).toEqual([]);
});

test("a failing migration applies nothing and throws", () => {
  addMigration("0001_note", "CREATE TABLE note (id integer PRIMARY KEY);");
  addMigration("0002_broken", "THIS IS NOT SQL;");

  expect(() => applyMigrations(opened.db, folder)).toThrow();
  expect(tables()).toEqual([]);

  // Once the broken migration is fixed, every one of them is still pending.
  writeFileSync(join(folder, "0002_broken.sql"), "SELECT 1;");
  expect(applyMigrations(opened.db, folder)).toEqual(["0000_baseline", "0001_note", "0002_broken"]);
});
