# b: On the rail

Bet: the history and Undo speak the report's own language, the timeline rail: Past imports hang on a rail by day, an undone one dashed and faded like a Duplicate; Undo is the report's last, open step ("Changed your mind?"), asking in a sheet from the foot of a phone that shows the studied, edited and moved counts as figures; undone, "Added to" is struck through and an "Undone" step closes the rail.

States: empty-history (`/decks/$deckId/import`: no section at all), undo, undone (`/imports/$importId`)

The history and Undo are faked in the browser (`apps/web/src/components/imports/prototype.ts`): the seeded Import is the live entry, beside a made-up undone one and a partly deleted one. Undo on the report and the toast's Undo work on the page and reset on reload.
