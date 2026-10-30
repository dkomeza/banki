# b: Margin

The study top bar stays and the editor comes in under it: from 1024 px a panel down the right with the Card on the left as it will read, changing as you type; below 1024 px a sheet up to the top bar. Edit is a pencil beside close; Reset progress is a bordered row that takes the accent when ticked and says what happens on save.

States: editing, editing-front, editing-new, reset, edited, discard (on `/decks/$deckId/study`); studied (on `/cards/$cardId`)

Prototype only: the API has no `studied` or `resetProgress` yet, so on the study screen every Card counts as studied except on `?state=editing-new`, the edit page shows the tick on `?state=studied`, and a Save with the tick saves the edit alone.
