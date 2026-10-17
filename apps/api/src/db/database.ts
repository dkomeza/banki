import { Database as SQLite } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { type BunSQLiteDatabase, drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "./schema";

/** The Drizzle handle every repository queries through. */
export type Database = BunSQLiteDatabase<typeof schema>;

export type OpenedDatabase = {
  db: Database;
  /** Closes the underlying SQLite connection; queries made afterwards throw. */
  close: () => void;
};

/**
 * Prepares the data directory (`<dataDir>/banki.db` and `<dataDir>/uploads/`),
 * creating whatever is missing, and opens the database with Banki's defaults.
 */
export function openDatabase(dataDir: string): OpenedDatabase {
  mkdirSync(join(dataDir, "uploads"), { recursive: true });

  const sqlite = new SQLite(join(dataDir, "banki.db"), { create: true, strict: true });
  try {
    // The timeout goes first: switching to WAL takes a lock, and another process
    // (a dev restart, an old container still shutting down) may briefly hold one.
    sqlite.run("PRAGMA busy_timeout = 5000");
    sqlite.run("PRAGMA journal_mode = WAL");
    sqlite.run("PRAGMA foreign_keys = ON");
    return { db: drizzle({ client: sqlite, schema }), close: () => sqlite.close() };
  } catch (error) {
    // e.g. banki.db exists but isn't a SQLite database.
    sqlite.close();
    throw error;
  }
}
