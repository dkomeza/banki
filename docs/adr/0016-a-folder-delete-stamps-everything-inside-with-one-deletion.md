# A Folder's delete stamps everything inside it with one Deletion

Deleting a Folder deletes everything in it, and Recently deleted (BAN-13) restores it all together. We record that by soft-deleting the Folder and every Folder and Deck inside it that isn't deleted yet, in one transaction, with the same `deletedAt` and the same deletion ID. Restore and the 30-day purge then work by deletion ID. A Deck or Folder that was deleted on its own before keeps its own earlier deletion, so restoring the Folder doesn't bring it back. Deleting a single Deck gets a deletion ID of its own too.

## Considered Options

- **Stamp only the Folder**, and treat what's inside as hidden because an ancestor is deleted: a delete or a restore is one write, but every check of whether a Deck is live would have to walk up its Folder chain, and the rule that names are unique among what's beside each other would have to say what counts inside a deleted Folder.

## Consequences

- Every query keeps the plain `deleted_at IS NULL` check, and name uniqueness stays a partial unique index over live rows.
- A Folder's delete writes one row per Folder and Deck inside it (and, later, per Card), which is fine at a single User's scale.
- Cards (BAN-12) join the same scheme: a Deck's delete, and a Folder's, stamps its Cards with the same deletion ID.
