# A moved Card takes its Reviews to its new Deck

A Card moved from Deck A to Deck B takes its whole history with it: its Reviews count for B from then on, in per-deck statistics and anything else that groups Reviews by Deck, and its memory state moves too, so only B's settings apply to it after the move. So a Move rewrites the Deck of the Card's Reviews in the same transaction. A Deck's statistics then always describe the Cards in it now, which is what "a moved card keeps its schedule and history" means to the User.

## Considered Options

- **Reviews stay with the Deck they happened in**: A's statistics wouldn't change on a Move, but B's would show a Card with no past, and a Deck's numbers would no longer describe its Cards.

## Consequences

- A Review still keeps a Deck ID (ADR-0018), but it is the Card's latest Deck, not the one it was reviewed in, so a removed Card's Reviews count for the Deck it was last in.
- No Reviews exist yet (M4): the Move's rewrite lands with the Review table.
