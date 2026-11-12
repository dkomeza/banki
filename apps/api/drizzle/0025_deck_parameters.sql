-- A Deck's own Parameters (ADR-0033): FSRS-6's 21 weights as a JSON list, null while it follows
-- the User's overall ones, which every Deck does until a Tuning fits it a set of its own.
ALTER TABLE `deck` ADD `fsrs_parameters` text;--> statement-breakpoint
-- The Deck a Tuning log row tuned, null for the overall Parameters, which is every row written
-- before this. Only the overall rows count towards the next automatic Tuning and its pause. A
-- Deck's rows go with its Removal; drizzle-kit leaves ON DELETE out of ALTER TABLE ADD, so it is
-- written by hand.
ALTER TABLE `parameter_tuning` ADD `deck_id` text REFERENCES `deck`(`id`) ON DELETE cascade;--> statement-breakpoint
CREATE INDEX `parameter_tuning_deck_id` ON `parameter_tuning` (`deck_id`);
