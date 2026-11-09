# a: Ledger

Bet: the history is a plain ledger, one card of hairline rows, and Undo is a quiet outline pill beside the report's actions that asks in a small centred dialog; undone, the report gains an "Undone" pill under its date and a last step on its timeline.

States: empty-history (`/decks/$deckId/import`: the card stays, with a one-line note), undo, undone (`/imports/$importId`)

The history and Undo are faked in the browser (`apps/web/src/components/imports/prototype.ts`): the seeded Import is the live entry, beside a made-up undone one and a partly deleted one. Undo on the report and the toast's Undo work on the page and reset on reload.
