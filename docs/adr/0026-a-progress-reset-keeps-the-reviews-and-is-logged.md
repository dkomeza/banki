# A Progress reset keeps the Reviews and is logged

This amends ADR-0025: a Card's newest Review can be undone only when it was given after the Card's newest Progress reset.

Editing a studied Card may put it back to New. That leaves its Reviews where they are, since they still count in statistics and Reviews never go but by Undo (ADR-0018, ADR-0025), and instead records the Progress reset itself, one row per Progress reset with its Card and moment. Whatever learns from a Card's Reviews (FSRS tuning, a Card's memory state) starts from its newest Progress reset, and a Card's history shows each one in its place among the Reviews.

## Considered Options

- **Delete the Card's Reviews**: a true clean slate, but statistics would lose history the User did study, and it would be the only way besides Undo that a Review goes.
- **Go back to New with no record**: tuning would read Reviews that lead to a state the Card no longer has, and nothing could show why its history restarts.
- **One "reset at" column on the Card**: enough for tuning, but a second reset would hide the first from the history.

## Consequences

- A Review given before its Card's newest Progress reset can't be undone: restoring the state it kept would undo the Progress reset too.
- FSRS tuning (M9) and per-card history (BAN-52) read the Progress reset log alongside the Reviews.
- Like a Card's Reviews, its Progress resets outlive its Removal (ADR-0018): the log has no foreign key to the Card, so it may name Cards that are gone.
- In a Session, a Card still counts as the kind it first came with after a Progress reset there: a review Card reset and rated again still counts toward the Recall rate.
