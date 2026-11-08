CREATE TABLE `import` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`deck_id` text NOT NULL,
	`file_name` text NOT NULL,
	`source` text NOT NULL,
	`created_at` integer NOT NULL,
	`confirmed_at` integer,
	`preview` text,
	`report` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`deck_id`) REFERENCES `deck`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "import_source" CHECK("import"."source" IN ('json', 'zip', 'paste'))
);
--> statement-breakpoint
CREATE INDEX `import_user_id` ON `import` (`user_id`);--> statement-breakpoint
CREATE INDEX `import_deck_id` ON `import` (`deck_id`);--> statement-breakpoint
CREATE INDEX `import_created_at` ON `import` (`created_at`);--> statement-breakpoint
-- Hand-written: drizzle-kit leaves ON DELETE off an added column's reference. ADD COLUMN keeps every
-- Card, which came from no Import (null).
ALTER TABLE `card` ADD `import_id` text REFERENCES `import`(`id`) ON DELETE set null;--> statement-breakpoint
CREATE INDEX `card_import_id` ON `card` (`import_id`);