# e: Contours

Bet: the most Cards on screen at once: small tiles, two across even on a phone and four on a desktop, each a contour map in ink with one ring in the accent, the Front on a frosted band across the map's foot and the Back on a solid muted strip.

Builds on Variant a (Index cards), from the Maintainer's feedback on round 1: every Card tile has the same height, its top 70% a graphic and its bottom 30% a solid colour, the Front on the graphic's lower part and the Back on the solid part, each at a fixed height, with an inset shadow where the text runs past it. New and edit are Variant a's, unchanged.

States: `/decks/$deckId`: `empty`, `undo`. `/decks/$deckId/cards/new`: `added`, `invalid`, `discard`. `/cards/$cardId`: `discard`, `not-found`.
