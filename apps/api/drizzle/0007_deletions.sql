CREATE INDEX `card_deletion_id` ON `card` (`deletion_id`);--> statement-breakpoint
CREATE INDEX `card_deleted_at` ON `card` (`deleted_at`);--> statement-breakpoint
CREATE INDEX `deck_deletion_id` ON `deck` (`deletion_id`);--> statement-breakpoint
CREATE INDEX `deck_deleted_at` ON `deck` (`deleted_at`);--> statement-breakpoint
CREATE INDEX `folder_deletion_id` ON `folder` (`deletion_id`);--> statement-breakpoint
CREATE INDEX `folder_deleted_at` ON `folder` (`deleted_at`);