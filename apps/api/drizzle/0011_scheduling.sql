CREATE TABLE `review` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`card_id` text NOT NULL,
	`deck_id` text NOT NULL,
	`reviewed_at` integer NOT NULL,
	`rating` text NOT NULL,
	`kind` text NOT NULL,
	`duration_ms` integer NOT NULL,
	`card_before` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "review_duration_ms" CHECK("review"."duration_ms" >= 0)
);
--> statement-breakpoint
CREATE INDEX `review_user_id` ON `review` (`user_id`);--> statement-breakpoint
CREATE INDEX `review_card_id_reviewed_at` ON `review` (`card_id`,`reviewed_at`);--> statement-breakpoint
CREATE INDEX `review_deck_id` ON `review` (`deck_id`);--> statement-breakpoint
ALTER TABLE `card` ADD `state` text DEFAULT 'new' NOT NULL;--> statement-breakpoint
ALTER TABLE `card` ADD `due_at` integer;--> statement-breakpoint
ALTER TABLE `card` ADD `stability` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `card` ADD `difficulty` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `card` ADD `reps` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `card` ADD `lapses` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `card` ADD `scheduled_days` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `card` ADD `learning_step` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `card` ADD `last_review_at` integer;--> statement-breakpoint
-- Hand-written in place of drizzle-kit's table rebuilds: rebuilding `deck` would cascade-delete its Cards
-- (PRAGMA foreign_keys can't change inside the migration's transaction). ADD COLUMN keeps every row,
-- and its CHECK holds for every row, the existing ones too, as each takes the column's default.
ALTER TABLE `deck` ADD `desired_retention` integer CONSTRAINT "deck_desired_retention" CHECK("desired_retention" BETWEEN 70 AND 97);--> statement-breakpoint
ALTER TABLE `user_settings` ADD `desired_retention` integer DEFAULT 90 NOT NULL CONSTRAINT "user_settings_desired_retention" CHECK("desired_retention" BETWEEN 70 AND 97);
