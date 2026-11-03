CREATE TABLE `progress_reset` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`card_id` text NOT NULL,
	`reset_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `progress_reset_user_id` ON `progress_reset` (`user_id`);--> statement-breakpoint
CREATE INDEX `progress_reset_card_id_reset_at` ON `progress_reset` (`card_id`,`reset_at`);