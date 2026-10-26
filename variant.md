# d: Paper cut

Bet: every Card is a tall tile, three across on a desktop, its top 70% a collage of paper shapes cut out and laid over each other (one in the accent, different on each Card), fading to the card colour where the Front sits, and the Back on a plain card strip below; the graphic is quiet, so the Front reads first.

Builds on Variant a (Index cards), from the Maintainer's feedback on round 1: every Card tile has the same height, its top 70% a graphic and its bottom 30% a solid colour, the Front on the graphic's lower part and the Back on the solid part, each at a fixed height, with an inset shadow where the text runs past it. New and edit are Variant a's, unchanged.

States: `/decks/$deckId`: `empty`, `undo`. `/decks/$deckId/cards/new`: `added`, `invalid`, `discard`. `/cards/$cardId`: `discard`, `not-found`.
