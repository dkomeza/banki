CREATE TABLE `image` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`format` text NOT NULL,
	`size` integer NOT NULL,
	`uploaded_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `image_user_id` ON `image` (`user_id`);--> statement-breakpoint
CREATE INDEX `image_uploaded_at` ON `image` (`uploaded_at`);