// The Drizzle schema: every table the API stores. drizzle-kit diffs it against
// the last snapshot in `drizzle/meta/` to generate a migration (`bun run db:generate`).
//
// better-auth's tables (the User row, auth sessions, credential accounts and
// verifications) are generated from Banki's auth options into `auth-schema.ts`
// by `bun run auth:generate`; never edit that file by hand.
import { DEFAULT_DAY_START_HOUR } from "@banki/shared";
import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
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
 * The User's Decks (ADR-0001). A deleted Deck keeps its row with `deletedAt`
 * set, and counts nowhere until it is restored. No two Decks beside each other
 * that aren't deleted share a name, ignoring case: `nameKey` is the name as
 * names are compared (`deckNameKey`), unique per User among those that aren't
 * deleted. All Decks sit at the root for now.
 */
export const deck = sqliteTable(
  "deck",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    nameKey: text("name_key").notNull(),
    /** Plain text with its line breaks; null for none. */
    description: text("description"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    uniqueIndex("deck_user_name_key")
      .on(table.userId, table.nameKey)
      .where(sql`${table.deletedAt} IS NULL`),
    index("deck_user_id").on(table.userId),
  ],
);
