# A Deck's Card limit counts live Cards and is checked where Cards enter

A Deck holds at most 1,000 Cards (`DECK_CARDS_MAX`), the import's own limit, so every Deck's export can be imported back as it is (BAN-34, BAN-105). The limit counts the Deck's live Cards only: its Cards in Recently deleted don't hold a place, so deleting Cards makes room at once. It is checked, in the same immediate transaction as the write, everywhere Cards enter a Deck: creating a Card, a Move (and a Move's Undo), confirming an Import, and restoring a Deletion of Cards on their own (a lone Card, a delete's Undo, an Import's Undo). A write that would take a Deck past the limit is refused whole with 409 `deck_full`, naming the Deck and its room. Restoring a Deck or a Folder isn't checked: its Cards come back with the Deck that held them, which nothing could enter while it was deleted. A Deck already over the limit when it landed keeps its Cards, and takes no more until it is under.

## Considered Options

- **Count deleted Cards too**: every Restore would fit, but a deleted Card would hold its place for 30 days, so deleting Cards to make room would only work after a Delete permanently, and the limit wouldn't match the Deck's own count.
- **Add as many as fit**: a Move or an Import over the room would take the first Cards and leave the rest. It saves the User unticking, but Banki, not the User, would choose which Cards stay out. The import's preview instead shows the room and keeps Confirm disabled while too many Cards are ticked.
- **Trim or split Decks already over the limit** in a migration: every Deck would obey the limit at once, but a migration would have to choose Cards or names for the User.

## Consequences

- A Restore, or a delete's or an Import's Undo being undone, can be refused while the Deck is full: after `place_deleted`, with `deck_full`, all or none.
- A Deck over the limit still exports as one file, which the import refuses, until the User moves or deletes enough of its Cards.
- Anything that adds Cards to a Deck later must check the room the same way.
