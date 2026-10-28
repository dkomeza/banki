CREATE TABLE `card_tag` (
	`card_id` text NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	PRIMARY KEY(`card_id`, `name`),
	FOREIGN KEY (`card_id`) REFERENCES `card`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `card_tag_user_id_name` ON `card_tag` (`user_id`,`name`);