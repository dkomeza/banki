# An Import's Undo is one Deletion, recorded on the Import

Undoing an Import (BAN-33) soft-deletes every live Card stamped with it, wherever it is now, edited or studied, in one transaction with one deletion ID. The Import row records that ID and when, in `undo_deletion_id` and `undone_at`. Recently deleted lists the Deletion as one entry of a fourth kind, Import, named by the Import's file, with its Deck and how many Cards it took, and Restore and Removal act on it as a whole, as on any other Deletion. Restoring it clears the Import's two columns, so the Import can be undone again; Removal leaves them, so its report still says it was undone.

## Considered Options

- **One Deletion per Card, as a delete of several picked Cards makes**: no new kind of Deletion, and the Undo toast restores them all at once. But an Import holds up to 1,000 Cards, so Recently deleted would flood with lone-Card entries, and once the toast is gone the Import could never be brought back as one.
- **Tell the Import's Deletion apart by the Cards' `import_id` alone**: no new columns, but a Card of the Import deleted on its own looks the same, and nothing would remember the undo after Removal.

## Consequences

- A Deletion's top item can now be an Import: whatever finds a Deletion's top item (listing, Restore) checks `import.undo_deletion_id` before treating card rows as a lone Card.
- One Deletion can hold Cards in several Decks, since a moved Card goes with its Import's Undo. Its Restore is refused, naming a Deck, while any of those Decks is deleted.
- The Import's Macros and Images are not part of the Deletion: Macros stay on the Deck, and Images follow ADR-0019.
