-- Hand-written in place of drizzle-kit's table rebuild, which copies the new column from the old table
-- (where it doesn't exist yet) and can't turn PRAGMA foreign_keys off inside the migration's transaction.
-- ADD COLUMN keeps every row, and the CHECK holds for the existing rows, as they take the column's default.
ALTER TABLE `user_settings` ADD `session_timeout_minutes` integer DEFAULT 30 NOT NULL CONSTRAINT "user_settings_session_timeout_minutes" CHECK("session_timeout_minutes" BETWEEN 5 AND 240);--> statement-breakpoint
-- Hand-written: a Review records at most 2 minutes (REVIEW_CAP_MS), so the ones recorded before the cap are capped too.
UPDATE `review` SET `duration_ms` = 120000 WHERE `duration_ms` > 120000;
