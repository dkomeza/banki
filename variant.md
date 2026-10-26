# a: Index cards

Bet: a deck is a pile of index cards: the deck page shows its Cards as a grid of small cards (Front over a dashed fold, Back under it), each opening its edit page, Delete in its ⋯ menu and New card as the section's primary pill; new and edit write on one big index card at reading width, the actions along its foot (Done / Save card, Delete … Cancel / Save), "Card added" there too; the Undo toast sits at the bottom centre.

States: `/decks/$deckId`: `empty`, `undo`. `/decks/$deckId/cards/new`: `added`, `invalid`, `discard`. `/cards/$cardId`: `discard`, `not-found`.
