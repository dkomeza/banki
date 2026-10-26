# b: Ledger

Bet: a deck's Cards are rows you scan: one bordered list with Front and Back side by side in two columns from 768 px (stacked on phones), a Delete button always on each row and New card as the list's first row; new and edit write Front and Back as two side-by-side faces from 1024 px, with Done / Save card (or Delete … Cancel / Save) in a bar stuck to the bottom of the screen, where "Card added" shows too; the Undo toast sits at the bottom right.

States: `/decks/$deckId`: `empty`, `undo`. `/decks/$deckId/cards/new`: `added`, `invalid`, `discard`. `/cards/$cardId`: `discard`, `not-found`.
