-- drizzle-kit writes an expression in an index as quoted columns, and leaves a
-- column's ON DELETE out of ALTER TABLE ADD, so both were fixed by hand.
CREATE TABLE `folder` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`parent_id` text,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`deletion_id` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_id`) REFERENCES `folder`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `folder_user_parent_name_key` ON `folder` (`user_id`,coalesce("parent_id", ''),`name_key`) WHERE "folder"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX `folder_user_id` ON `folder` (`user_id`);--> statement-breakpoint
CREATE INDEX `folder_parent_id` ON `folder` (`parent_id`);--> statement-breakpoint
DROP INDEX `deck_user_name_key`;--> statement-breakpoint
ALTER TABLE `deck` ADD `folder_id` text REFERENCES `folder`(`id`) ON UPDATE no action ON DELETE cascade;--> statement-breakpoint
ALTER TABLE `deck` ADD `deletion_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `deck_user_folder_name_key` ON `deck` (`user_id`,coalesce("folder_id", ''),`name_key`) WHERE "deck"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX `deck_folder_id` ON `deck` (`folder_id`);