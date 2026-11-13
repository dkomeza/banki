# A Deck gets Parameters of its own within the User's Tuning

A Deck with 1,000 Reviews or more (its Review rows, which follow its Cards through a Move, ADR-0021) gets Parameters fitted to its own Reviews; below that it follows the User's overall Parameters, which are still fitted from all their Reviews. Decks have no trigger of their own: each Tuning, automatic every 200 Reviews or Tune now, fits the overall Parameters first and then each live Deck past the threshold, one at a time under the same per-User lock. A Deck's new fit applies only when its log loss on the Deck's items is strictly lower than that of the Parameters the Deck uses then, its own or the overall ones as this Tuning left them. A Deck's own Parameters live on its row (`deck.fsrs_parameters`, null while it follows), and each Deck's attempt is a Tuning log row with its `deck_id`; only the overall rows (no `deck_id`) count towards the 200 Reviews and the pause. Applying any Parameters replays the Cards they apply to and keeps their due dates (ADR-0029), and a Move between Decks with different Parameters replays the moved Cards under their new Deck's. Reset to defaults clears every Deck's own Parameters with the overall ones.

## Considered Options

- **A trigger per Deck** (every 200 of its own Reviews): a big Deck would be refitted closer to its own pace, but each Deck would need its own count and pause, and Tuning would no longer be one thing the User can see and ask for in Settings.
- **One set per User only**: simpler, but a Deck whose material is remembered differently (vocabulary against derivations) would be scheduled by a model fitted mostly to other Decks.
- **No threshold, the library's call** (as the overall Parameters have): the improvement check is measured on the same Reviews the fit learned from, so a small Deck would almost always "improve" by overfitting; 1,000 Reviews keeps that in check.

## Consequences

- Everything that schedules a Card takes its Deck's Parameters, not the User's: Ratings, Interval previews, retention rescheduling, Undo's restore and the Queue's Predicted recall.
- A Deck keeps its own Parameters when it falls back under 1,000 Reviews, and while deleted, so a Restore brings them back; it is only not tuned again until it is back past the threshold. A Removed Deck's go with its row.
- A Move rewrites the moved Cards' memory states and their Reviews' `cardBefore` when the two Decks' Parameters differ.
- A Deck with its own Parameters gets its own Recommended retention (BAN-56), computed with its Deck Tuning row from its Reviews under its own Parameters.
