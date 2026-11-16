-- Each Deck's options for the Card prompt (BAN-35): a JSON object of its language, number of cards,
-- difficulty and extra instructions. Every Deck there is starts with the defaults.
ALTER TABLE `deck` ADD `card_prompt` text DEFAULT '{"language":"","count":null,"difficulty":"intermediate","instructions":""}' NOT NULL;