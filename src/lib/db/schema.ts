import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const decks = sqliteTable("decks", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  sourceName: text("source_name"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const cards = sqliteTable("cards", {
  id: text("id").primaryKey(),
  deckId: text("deck_id").notNull().references(() => decks.id, { onDelete: "cascade" }),
  sourceGuid: text("source_guid"),
  frontHtml: text("front_html").notNull(),
  backHtml: text("back_html").notNull(),
  tags: text("tags").notNull().default("[]"),
  position: integer("position").notNull().default(0),
  due: integer("due").notNull(),
  stability: real("stability").notNull().default(0),
  difficulty: real("difficulty").notNull().default(0),
  scheduledDays: integer("scheduled_days").notNull().default(0),
  learningSteps: integer("learning_steps").notNull().default(0),
  reps: integer("reps").notNull().default(0),
  lapses: integer("lapses").notNull().default(0),
  state: integer("state").notNull().default(0),
  lastReview: integer("last_review"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const reviews = sqliteTable("reviews", {
  id: text("id").primaryKey(),
  cardId: text("card_id").notNull().references(() => cards.id, { onDelete: "cascade" }),
  planId: text("plan_id"),
  rating: integer("rating").notNull(),
  previousState: integer("previous_state").notNull(),
  shownAt: integer("shown_at").notNull(),
  answeredAt: integer("answered_at").notNull(),
  durationMs: integer("duration_ms").notNull(),
  stability: real("stability").notNull(),
  difficulty: real("difficulty").notNull(),
  scheduledDays: integer("scheduled_days").notNull(),
});

export const plans = sqliteTable("plans", {
  id: text("id").primaryKey(),
  deckId: text("deck_id").notNull().references(() => decks.id, { onDelete: "cascade" }),
  deadlineDate: text("deadline_date").notNull(),
  dailyMinutes: integer("daily_minutes").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const media = sqliteTable("media", {
  id: text("id").primaryKey(),
  deckId: text("deck_id").notNull().references(() => decks.id, { onDelete: "cascade" }),
  originalName: text("original_name").notNull(),
  storedName: text("stored_name").notNull(),
  mimeType: text("mime_type").notNull(),
  size: integer("size").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const importReports = sqliteTable("import_reports", {
  id: text("id").primaryKey(),
  deckId: text("deck_id").references(() => decks.id, { onDelete: "set null" }),
  fileName: text("file_name").notNull(),
  importedCards: integer("imported_cards").notNull(),
  skippedCards: integer("skipped_cards").notNull(),
  importedMedia: integer("imported_media").notNull(),
  warnings: text("warnings").notNull().default("[]"),
  createdAt: integer("created_at").notNull(),
});

export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey(),
  timezone: text("timezone").notNull().default("Europe/Warsaw"),
  desiredRetention: real("desired_retention").notNull().default(0.9),
  fsrsWeights: text("fsrs_weights"),
  gradingEnabled: integer("grading_enabled", { mode: "boolean" }).notNull().default(true),
  gradingProvider: text("grading_provider").notNull().default("openai"),
  openaiApiKey: text("openai_api_key"),
  openrouterApiKey: text("openrouter_api_key"),
  openaiModel: text("openai_model"),
  updatedAt: integer("updated_at").notNull(),
});

export type Deck = typeof decks.$inferSelect;
export type StoredCard = typeof cards.$inferSelect;
export type Plan = typeof plans.$inferSelect;
