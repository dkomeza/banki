// The Drizzle schema: every table the API stores. drizzle-kit diffs it against
// the last snapshot in `drizzle/meta/` to generate a migration (`bun run db:generate`).
//
// better-auth's tables (the User row, auth sessions, credential accounts and
// verifications) are generated from Banki's auth options into `auth-schema.ts`
// by `bun run auth:generate`; never edit that file by hand.
import { DEFAULT_DAY_START_HOUR } from "@banki/shared";
import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
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
