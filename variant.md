# b: Tags menu

Bet: the list's top stays quiet: the "Cards" heading with a search field and a "Tags" button beside it, the Tags behind a searchable menu with a check and a count on each, like Banki's other pickers. Once anything narrows the list, a muted strip under it says "3 of 8 cards", lists the picked Tags as removable chips and offers Clear, and the list turns flat: one run of matches, each dated in the margin, with no highlighting. Each Card's Tags are quiet `#tag` labels at its foot, not tappable. On the new and edit pages the Tags field is written like the sides, on a ruled line with its label in the margin: soft accent `#chips` on the line, and suggestions as a row of dashed `+ tag` chips under it.

States: `/decks/$deckId`: `search`, `tags`, `no-match`, `empty`. `/decks/$deckId/cards/new`: `suggest`, `kept`. `/cards/$cardId`: `suggest`, `tag-error`.

Tags are prototype-only: kept in the browser (`apps/web/src/proto/tags.ts`), seeded by Card ID; a reload brings back the Seed data's Tags.
