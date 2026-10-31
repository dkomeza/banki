# d: Glide

Margin (b), with Sheet's (a) Edit pill beside Undo, in motion: from 1024 px the Card slides aside to become the preview as the panel slides in from the right, the dock sinks away, and on close it all slides back; below 1024 px the sheet rises over the Card and sinks back. The Reset progress row turns its arrow and swaps its line when ticked, and after a reset the accent chip pops in and the new Intervals come in one by one. Built on `dkomeza/ban-27-…-proto-b`.

States: editing, editing-front, editing-new, reset, edited, discard (on `/decks/$deckId/study`); studied (on `/cards/$cardId`)

Prototype only: the API has no `studied` or `resetProgress` yet, so on the study screen every Card counts as studied except on `?state=editing-new`, the edit page shows the tick on `?state=studied`, and a Save with the tick saves the edit alone. The motion plays when you open and close the editor yourself (Edit, E, Cancel, Esc, Save).
