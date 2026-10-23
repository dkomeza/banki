CREATE TABLE `user_settings` (
	`user_id` text PRIMARY KEY NOT NULL,
	`timezone` text,
	`day_start_hour` integer DEFAULT 4 NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "user_settings_day_start_hour" CHECK("user_settings"."day_start_hour" BETWEEN 0 AND 23)
);
