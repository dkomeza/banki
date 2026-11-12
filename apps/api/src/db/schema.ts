// The Drizzle schema: every table the API stores. drizzle-kit diffs it against
// the last snapshot in `drizzle/meta/` to generate a migration (`bun run db:generate`).
//
// better-auth's tables (the User row, auth sessions, credential accounts and
// verifications) are generated from Banki's auth options into `auth-schema.ts`
// by `bun run auth:generate`; never edit that file by hand.
import {
  ANSWER_MODES,
  CARD_STATES,
  type CardPromptOptions,
  DAILY_MINUTES_MAX,
  DAILY_MINUTES_MIN,
  DEFAULT_ANSWER_MODE,
  DEFAULT_CARD_PROMPT_OPTIONS,
  DEFAULT_DAY_START_HOUR,
  DEFAULT_DESIRED_RETENTION,
  DEFAULT_LEARNING_LIMIT,
  DEFAULT_NEW_CARD_BATCH,
  DEFAULT_SESSION_TIMEOUT_MINUTES,
  DESIRED_RETENTION_MAX,
  DESIRED_RETENTION_MIN,
  IMPORT_SOURCES,
  LEARNING_LIMIT_MAX,
  LEARNING_LIMIT_MIN,
  NEW_CARD_BATCH_MAX,
  NEW_CARD_BATCH_MIN,
  type Macro,
  RATINGS,
  REVIEW_KINDS,
  SESSION_TIMEOUT_MINUTES_MAX,
  SESSION_TIMEOUT_MINUTES_MIN,
  TUNING_OUTCOMES,
  TUNING_TRIGGERS,
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
import type { ImportReport, StagedImport } from "../imports/stored";
import { user } from "./auth-schema";

export * from "./auth-schema";

/** A CHECK's list of allowed values, quoted. */
const sqlList = (values: readonly string[]) =>
  sql.raw(values.map((value) => `'${value}'`).join(", "));

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
    /** How many New cards a Session introduces before it offers another batch. */
    newCardBatch: integer("new_card_batch").notNull().default(DEFAULT_NEW_CARD_BATCH),
    /** How many of a Deck's Cards may be in learning before a Session stops introducing New cards. */
    learningLimit: integer("learning_limit").notNull().default(DEFAULT_LEARNING_LIMIT),
    /** How many minutes a Session goes without activity before it ends. */
    sessionTimeoutMinutes: integer("session_timeout_minutes")
      .notNull()
      .default(DEFAULT_SESSION_TIMEOUT_MINUTES),
    /** Settings' Macros, every Deck's Cards use under its own: a JSON list of `{ name, definition }`. */
    macros: text("macros", { mode: "json" }).$type<Macro[]>().notNull().default([]),
    /** The Answer mode every Deck follows until it has its own. */
    answerMode: text("answer_mode", { enum: ANSWER_MODES }).notNull().default(DEFAULT_ANSWER_MODE),
    /** The Parameters FSRS schedules with, FSRS-6's 21 weights as a JSON list; null for its defaults. */
    fsrsParameters: text("fsrs_parameters", { mode: "json" }).$type<number[]>(),
  },
  (table) => [
    check("user_settings_day_start_hour", sql`${table.dayStartHour} BETWEEN 0 AND 23`),
    check(
      "user_settings_desired_retention",
      sql`${table.desiredRetention} BETWEEN ${sql.raw(String(DESIRED_RETENTION_MIN))} AND ${sql.raw(String(DESIRED_RETENTION_MAX))}`,
    ),
    check(
      "user_settings_new_card_batch",
      sql`${table.newCardBatch} BETWEEN ${sql.raw(String(NEW_CARD_BATCH_MIN))} AND ${sql.raw(String(NEW_CARD_BATCH_MAX))}`,
    ),
    check(
      "user_settings_learning_limit",
      sql`${table.learningLimit} BETWEEN ${sql.raw(String(LEARNING_LIMIT_MIN))} AND ${sql.raw(String(LEARNING_LIMIT_MAX))}`,
    ),
    check(
      "user_settings_session_timeout_minutes",
      sql`${table.sessionTimeoutMinutes} BETWEEN ${sql.raw(String(SESSION_TIMEOUT_MINUTES_MIN))} AND ${sql.raw(String(SESSION_TIMEOUT_MINUTES_MAX))}`,
    ),
    check(
      "user_settings_answer_mode",
      sql`${table.answerMode} IN (${sql.raw(ANSWER_MODES.map((mode) => `'${mode}'`).join(", "))})`,
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
    /** Its own Macros, on top of Settings': a JSON list of `{ name, definition }`. A deleted Deck keeps them. */
    macros: text("macros", { mode: "json" }).$type<Macro[]>().notNull().default([]),
    /** Its own Answer mode; null while it follows Settings. */
    answerMode: text("answer_mode", { enum: ANSWER_MODES }),
    /** Its options for the Card prompt, as `CardPromptOptions` checks them. A deleted Deck keeps them. */
    cardPrompt: text("card_prompt", { mode: "json" })
      .$type<CardPromptOptions>()
      .notNull()
      .default(DEFAULT_CARD_PROMPT_OPTIONS),
  },
  (table) => [
    check(
      "deck_desired_retention",
      sql`${table.desiredRetention} BETWEEN ${sql.raw(String(DESIRED_RETENTION_MIN))} AND ${sql.raw(String(DESIRED_RETENTION_MAX))}`,
    ),
    check(
      "deck_answer_mode",
      sql`${table.answerMode} IN (${sql.raw(ANSWER_MODES.map((mode) => `'${mode}'`).join(", "))})`,
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
    /** Its Grading notes, as typed; null for none. */
    gradingNotes: text("grading_notes"),
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
    /** The Import that added it; null for a Card made any other way, or whose Import is gone. */
    importId: text("import_id").references((): AnySQLiteColumn => card_import.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    index("card_user_id").on(table.userId),
    index("card_deck_id").on(table.deckId),
    index("card_deletion_id").on(table.deletionId),
    index("card_deleted_at").on(table.deletedAt),
    index("card_import_id").on(table.importId),
  ],
);

/**
 * The User's Reviews (CONTEXT.md): one Rating of one Card at one moment.
 * `cardId` and `deckId` carry no foreign key: a Card's Removal leaves its
 * Reviews in place, naming a Card and a Deck that may be gone (ADR-0018).
 * `deckId` is the Card's latest Deck, which a Move rewrites (ADR-0021).
 * `cardBefore` is the Card's memory state before the Review, as JSON
 * (`MemoryState` in scheduling/fsrs.ts), so Undo can put it back. `seq` is its
 * place in the User's Write order, shared with their Progress resets
 * (`nextSeq`): what came first goes by it, never by clocks, which can tie or
 * step back (ADR-0026).
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
    /** A graded Review's suggested Rating, as the client reported it (ADR-0028); null when self-rated. */
    suggestedRating: text("suggested_rating", { enum: RATINGS }),
    /** The ID of the Model that suggested a graded Review's Rating, any ID (ADR-0028); null when self-rated. */
    model: text("model"),
    /** The time spent studying the Card, as the client measured it (time spent editing it is left out), at most `REVIEW_CAP_MS`. */
    durationMs: integer("duration_ms").notNull(),
    cardBefore: text("card_before", { mode: "json" }).notNull(),
    seq: integer("seq").notNull().default(0),
  },
  (table) => [
    check("review_duration_ms", sql`${table.durationMs} >= 0`),
    check(
      "review_graded",
      sql`(${table.kind} = 'graded' AND ${table.suggestedRating} IS NOT NULL AND ${table.model} IS NOT NULL) OR (${table.kind} <> 'graded' AND ${table.suggestedRating} IS NULL AND ${table.model} IS NULL)`,
    ),
    index("review_card_id_user_id_seq").on(table.cardId, table.userId, table.seq),
    index("review_deck_id").on(table.deckId),
    uniqueIndex("review_user_id_seq").on(table.userId, table.seq),
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

/**
 * The User's Progress resets (CONTEXT.md, ADR-0026): one row each time one of
 * their Cards was put back to New while being edited. A reset leaves the
 * Card's Reviews in place; whatever learns from them starts from its Card's
 * newest one, and a Review from before it can't be undone. `cardId` carries no
 * foreign key: like a Review, a Progress reset outlives its Card's Removal
 * (ADR-0018). `seq` places it among the User's Reviews, as theirs does.
 */
export const progress_reset = sqliteTable(
  "progress_reset",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    cardId: text("card_id").notNull(),
    resetAt: integer("reset_at", { mode: "timestamp_ms" }).notNull(),
    seq: integer("seq").notNull(),
  },
  (table) => [
    index("progress_reset_card_id_user_id_seq").on(table.cardId, table.userId, table.seq),
    uniqueIndex("progress_reset_user_id_seq").on(table.userId, table.seq),
  ],
);

/**
 * The User's Imports (CONTEXT.md, ADR-0026): one row per Card file read into
 * a Deck. Unconfirmed, `preview` holds what was read from the file (its Cards,
 * invalid Cards, Macros and the zip's images, staged under
 * `<dataDir>/imports/<id>/`), and the sweep removes it 24 hours after
 * `createdAt`. Confirmed, `confirmedAt` is set, `preview` is null and `report`
 * holds what it did, kept for good; the Cards it added carry its ID.
 */
export const card_import = sqliteTable(
  "import",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    deckId: text("deck_id")
      .notNull()
      .references(() => deck.id, { onDelete: "cascade" }),
    /** The file's name as uploaded, or "pasted JSON". */
    fileName: text("file_name").notNull(),
    source: text("source", { enum: IMPORT_SOURCES }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    confirmedAt: integer("confirmed_at", { mode: "timestamp_ms" }),
    /** What was read from the file, as JSON (`StagedImport`, repositories/imports.ts); null once confirmed. */
    preview: text("preview", { mode: "json" }).$type<StagedImport>(),
    /** The report, as JSON (`ImportReport`, repositories/imports.ts); null until confirmed. */
    report: text("report", { mode: "json" }).$type<ImportReport>(),
    /** When it was last undone (ADR-0030); null unless undone. Restoring that Deletion clears it; Removal keeps it. */
    undoneAt: integer("undone_at", { mode: "timestamp_ms" }),
    /** The Deletion its last Undo made, the one its Cards carry; null unless undone. */
    undoDeletionId: text("undo_deletion_id"),
  },
  (table) => [
    check("import_source", sql`${table.source} IN ('json', 'zip', 'paste')`),
    index("import_user_id").on(table.userId),
    index("import_deck_id").on(table.deckId),
    index("import_created_at").on(table.createdAt),
    index("import_undo_deletion_id").on(table.undoDeletionId),
  ],
);

/**
 * The User's Tuning log (CONTEXT.md: Tuning): one row per Tuning attempt or
 * Reset to defaults, never changed once written but for its Recommended
 * retention, set right after (ADR-0032). `reviewCount` is how many of
 * the User's Reviews there were when it ran: the next automatic Tuning waits
 * for `TUNING_REVIEW_INTERVAL` more than the newest row's. The newest row is
 * the last written (`rowid`), as clocks can tie or step back. The log losses
 * are of the current Parameters and the new ones on the same items, null
 * where not measured; `parameters` is what it produced (FSRS-6's 21 weights as
 * a JSON list, the defaults for a Reset), null when it produced none.
 */
export const parameter_tuning = sqliteTable(
  "parameter_tuning",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    ranAt: integer("ran_at", { mode: "timestamp_ms" }).notNull(),
    trigger: text("trigger", { enum: TUNING_TRIGGERS }).notNull(),
    reviewCount: integer("review_count").notNull(),
    outcome: text("outcome", { enum: TUNING_OUTCOMES }).notNull(),
    /** The log loss of the Parameters in use when it ran. */
    currentLogLoss: real("current_log_loss"),
    /** The log loss of the Parameters it produced. */
    newLogLoss: real("new_log_loss"),
    parameters: text("parameters", { mode: "json" }).$type<number[]>(),
    /**
     * The Recommended retention worked out right after the row was written
     * (CONTEXT.md, ADR-0032), a whole percent from 70 to 97: null for a Reset,
     * while FSRS-6's defaults are in use, when working it out failed, and on
     * rows from before it existed. The newest row's is the current one.
     */
    recommendedRetention: integer("recommended_retention"),
  },
  (table) => [
    check("parameter_tuning_trigger", sql`${table.trigger} IN (${sqlList(TUNING_TRIGGERS)})`),
    check("parameter_tuning_outcome", sql`${table.outcome} IN (${sqlList(TUNING_OUTCOMES)})`),
    index("parameter_tuning_user_id").on(table.userId),
  ],
);

/**
 * The User's Plans (CONTEXT.md: Plan; ADR-0031): a Deadline and a Daily goal
 * for a Deck, one per Deck for now. `deadline` is the Study day itself
 * (`YYYY-MM-DD`), read with the Timezone and Day start as they are. A Deck's
 * delete leaves its Plan, so a Restore brings it back; its Removal deletes it.
 */
export const plan = sqliteTable(
  "plan",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    deckId: text("deck_id")
      .notNull()
      .references(() => deck.id, { onDelete: "cascade" }),
    deadline: text("deadline").notNull(),
    dailyMinutes: integer("daily_minutes").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    check(
      "plan_daily_minutes",
      sql`${table.dailyMinutes} BETWEEN ${sql.raw(String(DAILY_MINUTES_MIN))} AND ${sql.raw(String(DAILY_MINUTES_MAX))}`,
    ),
    uniqueIndex("plan_deck_id").on(table.deckId),
    index("plan_user_id").on(table.userId),
  ],
);
