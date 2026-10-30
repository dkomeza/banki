-- Hand-written in place of drizzle-kit's table rebuild, which copies the new columns from the old table
-- (where they don't exist yet) and can't turn PRAGMA foreign_keys off inside the migration's transaction.
-- ADD COLUMN keeps every row, and each CHECK holds for the existing rows, as they take the column's default.
ALTER TABLE `user_settings` ADD `new_card_batch` integer DEFAULT 20 NOT NULL CONSTRAINT "user_settings_new_card_batch" CHECK("new_card_batch" BETWEEN 5 AND 100);--> statement-breakpoint
ALTER TABLE `user_settings` ADD `learning_limit` integer DEFAULT 10 NOT NULL CONSTRAINT "user_settings_learning_limit" CHECK("learning_limit" BETWEEN 5 AND 50);
