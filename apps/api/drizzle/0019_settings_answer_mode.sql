-- Hand-written in place of drizzle-kit's table rebuild, which copies the new column from the old table
-- (where it doesn't exist yet) and can't turn PRAGMA foreign_keys off inside the migration's transaction.
-- ADD COLUMN keeps every row, and the CHECK holds for the existing rows, as they take the column's default.
ALTER TABLE `user_settings` ADD `answer_mode` text DEFAULT 'self-rate' NOT NULL CONSTRAINT "user_settings_answer_mode" CHECK("answer_mode" IN ('self-rate', 'write'));
