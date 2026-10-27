# a: Ledger bar

Bet: everything that narrows the list sits in one bar that sticks to the top as the list scrolls: a pill search field, then every Tag of the Deck as a chip with its count (one sideways-scrolling row on phones, wrapped from 640 px). The filtered list keeps the timeline's days, the words found are highlighted, the count reads "Cards 4 of 8", and each Card's `#tags` sit at its foot, a tap on one toggling it in the filter. On the new and edit pages the Tags field is a token field in the margin layout of Front and Back: chips with ×, the word being typed after them, suggestions in a list under it, the hint or the error beneath.

States: `/decks/$deckId`: `search`, `tags`, `no-match`, `empty`. `/decks/$deckId/cards/new`: `suggest`, `kept`. `/cards/$cardId`: `suggest`, `tag-error`.

Tags are prototype-only: kept in the browser (`apps/web/src/proto/tags.ts`), seeded by Card ID; a reload brings back the Seed data's Tags.
