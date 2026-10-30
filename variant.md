# a: Sheet

The editor is a sheet laid over Focus: full-screen on a phone, the edit page's card centred over the dimmed Card from 640 px; Edit sits beside Undo, and Reset progress is a plain checkbox line, with what it keeps, above the foot (Save becomes "Save and reset").

States: editing, editing-front, editing-new, reset, edited, discard (on `/decks/$deckId/study`); studied (on `/cards/$cardId`)

Prototype only: the API has no `studied` or `resetProgress` yet, so on the study screen every Card counts as studied except on `?state=editing-new`, the edit page shows the tick on `?state=studied`, and a Save with the tick saves the edit alone.
