-- Hand-written in place of drizzle-kit's table rebuild, which copies the new columns from the old table
-- (where they don't exist yet) and can't turn PRAGMA foreign_keys off inside the migration's transaction.
-- ADD COLUMN keeps every Review, and the CHECK, on the second column so it can name both, holds for the
-- existing ones: all self-rated, with neither.
ALTER TABLE `review` ADD `suggested_rating` text;--> statement-breakpoint
ALTER TABLE `review` ADD `model` text CONSTRAINT "review_graded" CHECK(("kind" = 'graded' AND "suggested_rating" IS NOT NULL AND "model" IS NOT NULL) OR ("kind" <> 'graded' AND "suggested_rating" IS NULL AND "model" IS NULL));
