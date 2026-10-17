-- Baseline: the starting point every later migration builds on. It changes nothing.
-- bun:sqlite rejects a statement that is only a comment, so it runs a no-op instead.
SELECT 1;
