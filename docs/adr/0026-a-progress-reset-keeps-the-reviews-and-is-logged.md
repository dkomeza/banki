# A Progress reset keeps the Reviews and is logged

Editing a studied Card may put it back to New. That leaves its Reviews where they are, since they still count in statistics and Reviews never go but by Undo (ADR-0018, ADR-0025), and instead records the Progress reset itself, one row per reset with its Card and moment. Whatever learns from a Card's Reviews (FSRS tuning, a Card's memory state) starts from its newest Progress reset, and a Card's history shows each one in its place among the Reviews.

## Considered Options

- **Delete the Card's Reviews**: a true clean slate, but statistics would lose history the User did study, and it would be the only way besides Undo that a Review goes.
- **Go back to New with no record**: tuning would read Reviews that lead to a state the Card no longer has, and nothing could show why its history restarts.
- **One "reset at" column on the Card**: enough for tuning, but a second reset would hide the first from the history.

## Consequences

- A Review given before its Card's newest Progress reset can't be undone: restoring the state it kept would undo the reset too.
- FSRS tuning (M9) and per-card history (BAN-52) read the reset log alongside the Reviews.
