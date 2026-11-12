CREATE TABLE `parameter_tuning` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`ran_at` integer NOT NULL,
	`trigger` text NOT NULL,
	`review_count` integer NOT NULL,
	`outcome` text NOT NULL,
	`current_log_loss` real,
	`new_log_loss` real,
	`parameters` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "parameter_tuning_trigger" CHECK("parameter_tuning"."trigger" IN ('automatic', 'manual', 'reset')),
	CONSTRAINT "parameter_tuning_outcome" CHECK("parameter_tuning"."outcome" IN ('applied', 'kept', 'not_enough_data', 'failed', 'reset'))
);
--> statement-breakpoint
CREATE INDEX `parameter_tuning_user_id` ON `parameter_tuning` (`user_id`);--> statement-breakpoint
ALTER TABLE `user_settings` ADD `fsrs_parameters` text;