# e: Morph

Margin (b), with Sheet's (a) Edit pill beside Undo, where the Card itself travels: opening and closing the editor are View Transitions, so from 1024 px the Card's Front, rule and Back glide from Focus to the preview beside the panel and back, the panel unrolls from the right edge and the dock sinks away; below 1024 px the sheet rises over the Card. After a reset, the dock rises back with the new Intervals turning over one by one and the accent chip popping in. Built on `dkomeza/ban-27-…-proto-b`.

States: editing, editing-front, editing-new, reset, edited, discard (on `/decks/$deckId/study`); studied (on `/cards/$cardId`)

Prototype only: the API has no `studied` or `resetProgress` yet, so on the study screen every Card counts as studied except on `?state=editing-new`, the edit page shows the tick on `?state=studied`, and a Save with the tick saves the edit alone. The motion plays when you open and close the editor yourself (Edit, E, Cancel, Esc, Save). A browser without View Transitions (or with reduced motion) gets the same screens without the motion.
