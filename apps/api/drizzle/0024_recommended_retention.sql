-- The Recommended retention worked out right after each Tuning log row (ADR-0032): a whole
-- percent from 70 to 97, null for a Reset, while the defaults are in use, on a failure, and on
-- the rows written before this, until the next Tuning.
ALTER TABLE `parameter_tuning` ADD `recommended_retention` integer;