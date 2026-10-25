CREATE TABLE `deck` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`description` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `deck_user_name_key` ON `deck` (`user_id`,`name_key`) WHERE "deck"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX `deck_user_id` ON `deck` (`user_id`);