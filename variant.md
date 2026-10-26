# h: Dialogue

Bet: a Card is a question and its answer, so the deck page reads as a conversation: each Card is an exchange, the Front in a bubble on the left and the Back in an accent-tinted bubble on the right, a quiet timestamp over each, newest at the top under a composer bar ("Ask something new…") that is the New card action, Delete in each exchange's ⋯ menu; new and edit write in the same two bubbles, with a round Save at the foot like a send button, and a Card just added shows above the empty bubbles as a sent exchange. Undo toast at the top centre.

Round 3, from the Maintainer's "do something entirely different": it builds on none of the earlier Variants (a to f), only on their shared base (the in-memory card store, Sonner, the Discard changes? guard).

States: `/decks/$deckId`: `empty`, `undo`. `/decks/$deckId/cards/new`: `added`, `invalid`, `discard`. `/cards/$cardId`: `discard`, `not-found`.
