import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { type OpenedDatabase, openDatabase } from "./database";

let tempDir: string;
let opened: OpenedDatabase;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "banki-db-"));
  opened = openDatabase(tempDir);
});

afterEach(() => {
  opened.close();
  rmSync(tempDir, { recursive: true, force: true });
});

// Each PRAGMA answers one row with one value.
const pragma = (name: string) => opened.db.values(sql.raw(`PRAGMA ${name}`));

test("opens SQLite in WAL mode", () => {
  expect(pragma("journal_mode")).toEqual([["wal"]]);
});

test("enforces foreign keys", () => {
  expect(pragma("foreign_keys")).toEqual([[1]]);
});

test("waits up to five seconds for a lock", () => {
  expect(pragma("busy_timeout")).toEqual([[5000]]);
});

test("applies its defaults again when an existing database is reopened", () => {
  opened.close();
  opened = openDatabase(tempDir);

  expect([pragma("journal_mode"), pragma("foreign_keys"), pragma("busy_timeout")]).toEqual([
    [["wal"]],
    [[1]],
    [[5000]],
  ]);
});
