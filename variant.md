# c: Composer

Bet: writing comes first: the deck page's Cards are one column of wide cards, the Front large and the Back on a muted panel under it, with Edit and Delete as plain words at each card's foot and New card a round button floating at the bottom right; new and edit are a quiet writing page with no boxes (a toolbar with ← the Deck and Save at the top, the Front at heading size, the Back under a rule, Done or Delete card at the foot), "Card added" right under the toolbar; the Undo toast drops in at the top centre.

States: `/decks/$deckId`: `empty`, `undo`. `/decks/$deckId/cards/new`: `added`, `invalid`, `discard`. `/cards/$cardId`: `discard`, `not-found`.
