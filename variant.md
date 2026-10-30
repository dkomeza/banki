# c: In place

Nothing opens: the Card turns into its own editor where it stands in Focus's column, the top bar reads "Editing", and the dock trades the ratings for the editor's foot, with Reset progress on top of it where the Intervals it changes were (Save becomes "Save as new"). Edit is an outlined pill with its key, a mode you step into.

States: editing, editing-front, editing-new, reset, edited, discard (on `/decks/$deckId/study`); studied (on `/cards/$cardId`)

Prototype only: the API has no `studied` or `resetProgress` yet, so on the study screen every Card counts as studied except on `?state=editing-new`, the edit page shows the tick on `?state=studied`, and a Save with the tick saves the edit alone.
