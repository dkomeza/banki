# g: Workbench

Bet: the Deck stays in view while you read and write, like a mail or notes app: the deck page's Cards are a list pane of rows (Front, the start of the Back, when it was written) beside a reading pane showing the selected Card whole, with Edit and Delete on it; new and edit keep the same list pane on the left, the Card being written highlighted, and the editor on the right with Save in its toolbar, so you hop from Card to Card without going back. Below 1024 px the panes stack: rows open the edit page, and the editor stands alone. Undo toast at the bottom right.

From 1024 px a click on a row selects it into the reading pane rather than opening its edit page (Edit is on the pane); below that, a row opens its edit page as the spec says.

Round 3, from the Maintainer's "do something entirely different": it builds on none of the earlier Variants (a to f), only on their shared base (the in-memory card store, Sonner, the Discard changes? guard).

States: `/decks/$deckId`: `empty`, `undo`. `/decks/$deckId/cards/new`: `added`, `invalid`, `discard`. `/cards/$cardId`: `discard`, `not-found`.
