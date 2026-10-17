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

test("waits for another process's lock when switching a fresh database to WAL", async () => {
  const dataDir = join(tempDir, "locked");
  // Another process creates banki.db in SQLite's default journal mode and holds
  // an exclusive lock on it for a moment, as a server still shutting down might.
  const holder = Bun.spawn(
    [
      "bun",
      "-e",
      `const { Database } = require("bun:sqlite");
       require("node:fs").mkdirSync(process.argv[1], { recursive: true });
       const db = new Database(process.argv[1] + "/banki.db");
       db.run("BEGIN EXCLUSIVE");
       console.log("locked");
       Bun.sleepSync(300);
       db.run("COMMIT");`,
      dataDir,
    ],
    { stdout: "pipe" },
  );
  const reader = holder.stdout.getReader();
  await reader.read();

  const second = openDatabase(dataDir);
  second.close();
  expect(await holder.exited).toBe(0);
});
