ALTER TABLE `import` ADD `undone_at` integer;--> statement-breakpoint
ALTER TABLE `import` ADD `undo_deletion_id` text;--> statement-breakpoint
CREATE INDEX `import_undo_deletion_id` ON `import` (`undo_deletion_id`);