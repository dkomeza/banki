# i: Journal

Bet: a Deck is written over days, so its Cards read as a journal: the deck page hangs them on a timeline grouped under the day they were written (Today, Yesterday, Fri 23 Oct), each with its time in the margin, the Front in ink and the Back under it, Delete in its ⋯ menu, the newest Card's dot in the accent and New card as the timeline's first entry; new and edit are a dated page, the two sides written on ruled lines with their labels in the margin, and on new the Cards written this visit gather under the form as a small timeline. Undo toast at the bottom centre.

Round 3, from the Maintainer's "do something entirely different": it builds on none of the earlier Variants (a to f), only on their shared base (the in-memory card store, Sonner, the Discard changes? guard).

States: `/decks/$deckId`: `empty`, `undo`. `/decks/$deckId/cards/new`: `added`, `invalid`, `discard`. `/cards/$cardId`: `discard`, `not-found`.
