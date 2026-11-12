-- A table of its own: no `deck` rebuild, so no Card is touched (ADR-0031).
CREATE TABLE `plan` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`deck_id` text NOT NULL,
	`deadline` text NOT NULL,
	`daily_minutes` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`deck_id`) REFERENCES `deck`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "plan_daily_minutes" CHECK("plan"."daily_minutes" BETWEEN 5 AND 600)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `plan_deck_id` ON `plan` (`deck_id`);--> statement-breakpoint
CREATE INDEX `plan_user_id` ON `plan` (`user_id`);