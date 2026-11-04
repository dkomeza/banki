# A Progress reset keeps the Reviews and is logged

This amends ADR-0025: a Card's newest Review can be undone only when it was given after the Card's newest Progress reset.

Editing a studied Card may put it back to New. That leaves its Reviews where they are, since they still count in statistics and Reviews never go but by Undo (ADR-0018, ADR-0025), and instead records the Progress reset itself, one row per Progress reset with its Card and moment. Reviews and Progress resets share one Write order per User, a number each one takes as it is written, and "before" and "newest" go by it rather than by their moments, since a server clock can tie or step back. Whatever learns from a Card's Reviews (FSRS tuning, a Card's memory state) starts from its newest Progress reset, and a Card's history shows each one in its place among the Reviews.

## Considered Options

- **Delete the Card's Reviews**: a true clean slate, but statistics would lose history the User did study, and it would be the only way besides Undo that a Review goes.
- **Go back to New with no record**: tuning would read Reviews that lead to a state the Card no longer has, and nothing could show why its history restarts.
- **Order by moments**: no extra column, but a Rating and a Progress reset in the same millisecond tie, and a clock that steps back puts a Rating from before a Progress reset after it.
- **One column on the Card, the moment of its newest Progress reset**: no new table, but it orders by moments too, as the option above does, and a second Progress reset would hide the first from the history.

## Consequences

- A Review given before its Card's newest Progress reset can't be undone: restoring the state it kept would undo the Progress reset too.
- FSRS tuning (M9) and per-card history (BAN-52) read the Progress reset log alongside the Reviews, in the Write order.
- Reviews given before the Write order existed take their places in it by their moments, as well as the database can tell.
- Like a Card's Reviews, its Progress resets outlive its Removal (ADR-0018): the log has no foreign key to the Card, so it may name Cards that are gone. Unlike a Review, a Progress reset keeps no Deck (ADR-0021): it is a fact about its Card alone, and nothing counts Progress resets by Deck. Deck-level history that needs one places it by the Reviews around it.
- A place in the Write order isn't permanent, as a Review isn't (ADR-0025): an Undo frees its Review's `seq`. The next Review or Progress reset takes one past the User's highest, which is the freed one again only when nothing was written after it, so a place in the Write order can stay unused. Whatever reads the log in steps (M9 tuning) goes by the rows as they are, not by a remembered `seq`.
- In a Session, a Card still counts as the kind it first came with after a Progress reset there: a review Card put back to New and rated again still counts toward the Recall rate.
