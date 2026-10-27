# c: One query line

Bet: search and Tags are one thing to type into: a single wide field where picked Tags sit as filled `#chips` before the words, typing `#` offers the Deck's Tags with their counts, and Backspace takes the last Tag off; under it, the Deck's Tags as a quiet line of `#links` to tap. The heading turns into "Cards · 3 matches" in the accent, the list keeps the timeline's days, and the words found are set in ink and underlined in the accent. Each Card leads with its `#tags` in the accent above the Front, each tappable to filter by it. On the new and edit pages the Tags are the writing card's last row, full width under a dashed hairline with a "3 / 20" count: outlined chips, then an "Add tag" pill typed into, with suggestions dropping from it and a new word offered as a new Tag.

States: `/decks/$deckId`: `search`, `tags`, `no-match`, `empty`. `/decks/$deckId/cards/new`: `suggest`, `kept`. `/cards/$cardId`: `suggest`, `tag-error`.

Tags are prototype-only: kept in the browser (`apps/web/src/proto/tags.ts`), seeded by Card ID; a reload brings back the Seed data's Tags.
