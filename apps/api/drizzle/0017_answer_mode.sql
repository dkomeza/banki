-- Hand-written in place of drizzle-kit's table rebuild, which would drop and re-create `deck` with PRAGMA
-- foreign_keys left on inside the migration's transaction, so the drop would cascade to every Card.
-- ADD COLUMN keeps every row, and the CHECK holds for the existing Decks, which follow Settings (null).
ALTER TABLE `deck` ADD `answer_mode` text CONSTRAINT "deck_answer_mode" CHECK("answer_mode" IN ('self-rate', 'write'));
