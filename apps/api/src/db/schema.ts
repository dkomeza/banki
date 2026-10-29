// The Drizzle schema: every table the API stores. drizzle-kit diffs it against
// the last snapshot in `drizzle/meta/` to generate a migration (`bun run db:generate`).
//
// better-auth's tables (the User row, auth sessions, credential accounts and
// verifications) are generated from Banki's auth options into `auth-schema.ts`
// by `bun run auth:generate`; never edit that file by hand.
import {
  CARD_STATES,
  DEFAULT_DAY_START_HOUR,
  DEFAULT_DESIRED_RETENTION,
  DESIRED_RETENTION_MAX,
  DESIRED_RETENTION_MIN,
  RATINGS,
  REVIEW_KINDS,
} from "@banki/shared";
import { sql } from "drizzle-orm";
import {
  type AnySQLiteColumn,
  check,
  index,
  integer,
  primaryKey,
  real,
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
    /** The editor's auto-close; null for the default. One Banki no longer knows reads as the default. */
    autoClose: text("auto_close"),
    /** The Desired retention every Deck follows until it has its own, a whole percent. */
    desiredRetention: integer("desired_retention").notNull().default(DEFAULT_DESIRED_RETENTION),
  },
  (table) => [
    check("user_settings_day_start_hour", sql`${table.dayStartHour} BETWEEN 0 AND 23`),
    check(
      "user_settings_desired_retention",
      sql`${table.desiredRetention} BETWEEN ${sql.raw(String(DESIRED_RETENTION_MIN))} AND ${sql.raw(String(DESIRED_RETENTION_MAX))}`,
    ),
  ],
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
    index("folder_deletion_id").on(table.deletionId),
    index("folder_deleted_at").on(table.deletedAt),
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
    /** Its own Desired retention, a whole percent; null while it follows Settings. */
    desiredRetention: integer("desired_retention"),
  },
  (table) => [
    check(
      "deck_desired_retention",
      sql`${table.desiredRetention} BETWEEN ${sql.raw(String(DESIRED_RETENTION_MIN))} AND ${sql.raw(String(DESIRED_RETENTION_MAX))}`,
    ),
    uniqueIndex("deck_user_folder_name_key")
      .on(table.userId, sql`coalesce(${table.folderId}, '')`, table.nameKey)
      .where(sql`${table.deletedAt} IS NULL`),
    index("deck_user_id").on(table.userId),
    index("deck_folder_id").on(table.folderId),
    index("deck_deletion_id").on(table.deletionId),
    index("deck_deleted_at").on(table.deletedAt),
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
    // Its memory state, as FSRS left it after its last Review (scheduling/fsrs.ts).
    /** Where it is in FSRS (`CARD_STATES`); `new` until its first Review. */
    state: text("state", { enum: CARD_STATES }).notNull().default("new"),
    /**
     * When it is due; null while new. Past its learning steps, the Day start of
     * the Study day it is due on (ADR-0024); in them, the exact moment.
     */
    dueAt: integer("due_at", { mode: "timestamp_ms" }),
    stability: real("stability").notNull().default(0),
    difficulty: real("difficulty").notNull().default(0),
    reps: integer("reps").notNull().default(0),
    lapses: integer("lapses").notNull().default(0),
    /** The days its last Review scheduled it out; 0 in learning steps. */
    scheduledDays: integer("scheduled_days").notNull().default(0),
    /** Which learning step it is on, while in them. */
    learningStep: integer("learning_step").notNull().default(0),
    lastReviewAt: integer("last_review_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    index("card_user_id").on(table.userId),
    index("card_deck_id").on(table.deckId),
    index("card_deletion_id").on(table.deletionId),
    index("card_deleted_at").on(table.deletedAt),
  ],
);

/**
 * The User's Reviews (CONTEXT.md): one Rating of one Card at one moment.
 * `cardId` and `deckId` carry no foreign key: a Card's Removal leaves its
 * Reviews in place, naming a Card and a Deck that may be gone (ADR-0018).
 * `deckId` is the Card's latest Deck, which a Move rewrites (ADR-0021).
 * `cardBefore` is the Card's memory state before the Review, as JSON
 * (`MemoryState` in scheduling/fsrs.ts), so Undo can put it back.
 */
export const review = sqliteTable(
  "review",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    cardId: text("card_id").notNull(),
    deckId: text("deck_id").notNull(),
    reviewedAt: integer("reviewed_at", { mode: "timestamp_ms" }).notNull(),
    rating: text("rating", { enum: RATINGS }).notNull(),
    kind: text("kind", { enum: REVIEW_KINDS }).notNull(),
    /** The time spent on the Card, as the client measured it. */
    durationMs: integer("duration_ms").notNull(),
    cardBefore: text("card_before", { mode: "json" }).notNull(),
  },
  (table) => [
    check("review_duration_ms", sql`${table.durationMs} >= 0`),
    index("review_user_id").on(table.userId),
    index("review_card_id_reviewed_at").on(table.cardId, table.reviewedAt),
    index("review_deck_id").on(table.deckId),
  ],
);

/**
 * A Tag a Card carries, one row per Card and Tag. `name` is stored lowercase,
 * as `TagName` parses it. Soft deletes leave it alone: a deleted Card keeps its
 * Tags and gets them back on Restore, and they go only with the Card's Removal.
 */
export const card_tag = sqliteTable(
  "card_tag",
  {
    cardId: text("card_id")
      .notNull()
      .references(() => card.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.cardId, table.name] }),
    index("card_tag_user_id_name").on(table.userId, table.name),
  ],
);

/**
 * The User's Images (ADR-0001): one row per uploaded file, kept byte for byte
 * as `<dataDir>/uploads/<id>.<ext>`, the extension its `format` has
 * (`IMAGE_FORMATS`). An Image has no owner among the Cards: it is kept while
 * any Card of the User's that isn't Removed refers to it (ADR-0019).
 */
export const image = sqliteTable(
  "image",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    format: text("format", { enum: ["png", "jpeg", "webp", "gif"] }).notNull(),
    /** Its size in bytes. */
    size: integer("size").notNull(),
    uploadedAt: integer("uploaded_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("image_user_id").on(table.userId),
    index("image_uploaded_at").on(table.uploadedAt),
  ],
);
