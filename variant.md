# f: Blocks

Bet: the boldest face: wide tiles, two across from a tablet up, each a grid of paper blocks (quarter and half circles, squares, one in the accent) going quiet where the Front sits large, and the Back in paper-coloured text on a solid ink strip, so Front and Back read as two halves at a glance.

Builds on Variant a (Index cards), from the Maintainer's feedback on round 1: every Card tile has the same height, its top 70% a graphic and its bottom 30% a solid colour, the Front on the graphic's lower part and the Back on the solid part, each at a fixed height, with an inset shadow where the text runs past it. New and edit are Variant a's, unchanged.

States: `/decks/$deckId`: `empty`, `undo`. `/decks/$deckId/cards/new`: `added`, `invalid`, `discard`. `/cards/$cardId`: `discard`, `not-found`.
