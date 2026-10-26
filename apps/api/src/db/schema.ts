// The Drizzle schema: every table the API stores. drizzle-kit diffs it against
// the last snapshot in `drizzle/meta/` to generate a migration (`bun run db:generate`).
//
// better-auth's tables (the User row, auth sessions, credential accounts and
// verifications) are generated from Banki's auth options into `auth-schema.ts`
// by `bun run auth:generate`; never edit that file by hand.
import { DEFAULT_DAY_START_HOUR } from "@banki/shared";
import { sql } from "drizzle-orm";
import {
  type AnySQLiteColumn,
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { user } from "./auth-schema";

export * from "./auth-schema";

/**
 * The User's Settings, one row per User (ADR-0001), created on first change: a
 * User without one has the defaults. Later Settings add their own columns.
 */
export const user_settings = sqliteTable(
  "user_settings",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    /** An IANA name; null until the first browser's zone fills it in. */
    timezone: text("timezone"),
    dayStartHour: integer("day_start_hour").notNull().default(DEFAULT_DAY_START_HOUR),
    /** The Model's OpenRouter ID; null for the default. One a later release dropped reads as the default. */
    model: text("model"),
    /** The API key, encrypted (ADR-0014; see createApiKeyCipher); null when none is stored. */
    apiKeyEncrypted: text("api_key_encrypted"),
    /** The API key's last four characters, all Settings shows of it; set exactly when it is. */
    apiKeyLastFour: text("api_key_last_four"),
  },
  (table) => [check("user_settings_day_start_hour", sql`${table.dayStartHour} BETWEEN 0 AND 23`)],
);

/**
 * The User's Folders (ADR-0001), nested to any depth: `parentId` is the Folder
 * one sits in, null at the Root. A deleted Folder keeps its row with
 * `deletedAt` set, and so does everything that was inside it when it was
 * deleted, stamped with the same `deletionId` (ADR-0016). No two Folders
 * beside each other that aren't deleted share a name, ignoring case:
 * `nameKey` is the name as names are compared (`deckNameKey`). SQLite counts
 * NULLs as distinct, so the unique index reads the Root as '', one place.
 */
export const folder = sqliteTable(
  "folder",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    parentId: text("parent_id").references((): AnySQLiteColumn => folder.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    nameKey: text("name_key").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
    /** The Deletion it went with, shared by everything deleted together; null while live. */
    deletionId: text("deletion_id"),
  },
  (table) => [
    uniqueIndex("folder_user_parent_name_key")
      .on(table.userId, sql`coalesce(${table.parentId}, '')`, table.nameKey)
      .where(sql`${table.deletedAt} IS NULL`),
    index("folder_user_id").on(table.userId),
    index("folder_parent_id").on(table.parentId),
  ],
);

/**
 * The User's Decks (ADR-0001), each at the Root (`folderId` null) or in one
 * Folder. A deleted Deck keeps its row with `deletedAt` and `deletionId` set,
 * and counts nowhere until it is restored. No two Decks beside each other that
 * aren't deleted share a name, ignoring case: `nameKey` is the name as names
 * are compared (`deckNameKey`), unique per place among those that aren't
 * deleted, the Root read as '' as for Folders.
 */
export const deck = sqliteTable(
  "deck",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    folderId: text("folder_id").references(() => folder.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    nameKey: text("name_key").notNull(),
    /** Plain text with its line breaks; null for none. */
    description: text("description"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
    /** The Deletion it went with (ADR-0016); null while live. */
    deletionId: text("deletion_id"),
  },
  (table) => [
    uniqueIndex("deck_user_folder_name_key")
      .on(table.userId, sql`coalesce(${table.folderId}, '')`, table.nameKey)
      .where(sql`${table.deletedAt} IS NULL`),
    index("deck_user_id").on(table.userId),
    index("deck_folder_id").on(table.folderId),
  ],
);

/**
 * The User's Cards (ADR-0001), each in one Deck. `front` and `back` are
 * Markdown with LaTeX, stored exactly as typed (ADR-0004). A deleted Card keeps
 * its row with `deletedAt` and `deletionId` set: a deletion of its own, or its
 * Deck's or Folder's when it went with them (ADR-0016).
 */
export const card = sqliteTable(
  "card",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    deckId: text("deck_id")
      .notNull()
      .references(() => deck.id, { onDelete: "cascade" }),
    front: text("front").notNull(),
    back: text("back").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
    /** The Deletion it went with (ADR-0016); null while live. */
    deletionId: text("deletion_id"),
  },
  (table) => [index("card_user_id").on(table.userId), index("card_deck_id").on(table.deckId)],
);
