import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import * as schema from "./schema";

const isProductionBuild = process.env.NEXT_PHASE === "phase-production-build";
const databasePath = isProductionBuild
  ? path.join(os.tmpdir(), `banki-build-${process.pid}.db`)
  : process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "banki.db");
fs.mkdirSync(path.dirname(databasePath), { recursive: true });

const globalForDb = globalThis as unknown as { bankiSqlite?: Database.Database };
const sqlite = globalForDb.bankiSqlite ?? new Database(databasePath, { timeout: 10_000 });
if (process.env.NODE_ENV !== "production") globalForDb.bankiSqlite = sqlite;

sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS decks (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
    source_name TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS cards (
    id TEXT PRIMARY KEY, deck_id TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
    source_guid TEXT, front_html TEXT NOT NULL, back_html TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '[]',
    position INTEGER NOT NULL DEFAULT 0, due INTEGER NOT NULL, stability REAL NOT NULL DEFAULT 0,
    difficulty REAL NOT NULL DEFAULT 0, scheduled_days INTEGER NOT NULL DEFAULT 0,
    learning_steps INTEGER NOT NULL DEFAULT 0, reps INTEGER NOT NULL DEFAULT 0,
    lapses INTEGER NOT NULL DEFAULT 0, state INTEGER NOT NULL DEFAULT 0, last_review INTEGER,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS cards_deck_due_idx ON cards(deck_id, due);
  CREATE TABLE IF NOT EXISTS reviews (
    id TEXT PRIMARY KEY, card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    plan_id TEXT, rating INTEGER NOT NULL, previous_state INTEGER NOT NULL,
    shown_at INTEGER NOT NULL, answered_at INTEGER NOT NULL, duration_ms INTEGER NOT NULL,
    stability REAL NOT NULL, difficulty REAL NOT NULL, scheduled_days INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS reviews_card_answered_idx ON reviews(card_id, answered_at);
  CREATE TABLE IF NOT EXISTS plans (
    id TEXT PRIMARY KEY, deck_id TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
    deadline_date TEXT NOT NULL, daily_minutes INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS media (
    id TEXT PRIMARY KEY, deck_id TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
    original_name TEXT NOT NULL, stored_name TEXT NOT NULL, mime_type TEXT NOT NULL,
    size INTEGER NOT NULL, created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS import_reports (
    id TEXT PRIMARY KEY, deck_id TEXT REFERENCES decks(id) ON DELETE SET NULL,
    file_name TEXT NOT NULL, imported_cards INTEGER NOT NULL, skipped_cards INTEGER NOT NULL,
    imported_media INTEGER NOT NULL, warnings TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY, timezone TEXT NOT NULL DEFAULT 'Europe/Warsaw',
    desired_retention REAL NOT NULL DEFAULT 0.9, fsrs_weights TEXT,
    grading_enabled INTEGER NOT NULL DEFAULT 1, grading_provider TEXT NOT NULL DEFAULT 'openai',
    openai_api_key TEXT, openrouter_api_key TEXT, openai_model TEXT,
    updated_at INTEGER NOT NULL
  );
  INSERT OR IGNORE INTO settings (id, timezone, desired_retention, updated_at)
  VALUES (1, 'Europe/Warsaw', 0.9, unixepoch() * 1000);
`);

const settingColumns = new Set((sqlite.prepare("PRAGMA table_info(settings)").all() as Array<{ name: string }>).map((column) => column.name));
if (!settingColumns.has("grading_enabled")) sqlite.exec("ALTER TABLE settings ADD COLUMN grading_enabled INTEGER NOT NULL DEFAULT 1");
if (!settingColumns.has("grading_provider")) sqlite.exec("ALTER TABLE settings ADD COLUMN grading_provider TEXT NOT NULL DEFAULT 'openai'");
if (!settingColumns.has("openai_api_key")) sqlite.exec("ALTER TABLE settings ADD COLUMN openai_api_key TEXT");
if (!settingColumns.has("openrouter_api_key")) sqlite.exec("ALTER TABLE settings ADD COLUMN openrouter_api_key TEXT");
if (!settingColumns.has("openai_model")) sqlite.exec("ALTER TABLE settings ADD COLUMN openai_model TEXT");

export const db = drizzle(sqlite, { schema });
export { sqlite };
