# c: Receipts

Bet: each past Import is a receipt-like tile built around its card count, two to a row, an undone one muted with its figure struck and an Undone tag; on the report, Undo is a row at the top ("5 cards from this import still here · Undo import") whose confirmation opens in place, inside the row, as design.md's rows open their forms, and undone, that row turns into a muted "Undone …" note with a way to Recently deleted.

States: empty-history (`/decks/$deckId/import`: a dashed one-line tile), undo, undone (`/imports/$importId`)

The history and Undo are faked in the browser (`apps/web/src/components/imports/prototype.ts`): the seeded Import is the live entry, beside a made-up undone one and a partly deleted one. Undo on the report and the toast's Undo work on the page and reset on reload.
