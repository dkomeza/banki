CREATE TABLE `progress_reset` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`card_id` text NOT NULL,
	`reset_at` integer NOT NULL,
	`seq` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `progress_reset_card_id_user_id_seq` ON `progress_reset` (`card_id`,`user_id`,`seq`);--> statement-breakpoint
CREATE UNIQUE INDEX `progress_reset_user_id_seq` ON `progress_reset` (`user_id`,`seq`);--> statement-breakpoint
ALTER TABLE `review` ADD `seq` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Hand-written: number each User's existing Reviews in the order they were
-- given, as far as the database can tell, before `seq` has to be unique.
UPDATE `review` SET `seq` = (
	SELECT `ordered`.`n` FROM (
		SELECT `id`, row_number() OVER (PARTITION BY `user_id` ORDER BY `reviewed_at`, rowid) AS `n` FROM `review`
	) AS `ordered` WHERE `ordered`.`id` = `review`.`id`
);--> statement-breakpoint
CREATE INDEX `review_card_id_user_id_seq` ON `review` (`card_id`,`user_id`,`seq`);--> statement-breakpoint
CREATE UNIQUE INDEX `review_user_id_seq` ON `review` (`user_id`,`seq`);--> statement-breakpoint
DROP INDEX `review_user_id`;--> statement-breakpoint
DROP INDEX `review_card_id_reviewed_at`;