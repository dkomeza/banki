# An undone Review is deleted

Undo on the study screen takes back a Rating by deleting its Review and putting the Card's memory state back to the one that Review kept from before it. An Undo means "that wasn't my answer", usually a misclick, so the Review never reaches FSRS tuning, statistics or a Card's history. Only a Card's newest Review can be undone, since each Review's memory state follows from the one before it. This is the one way a Review ever goes: Removal still never removes Reviews (ADR-0018).

## Considered Options

- **Keep the Review, marked undone**: an audit trail of misclicks, but every reader of Reviews (the Queue, FSRS tuning, statistics, a Card's history) would have to skip the undone ones, and one that forgot would count a Rating the User took back.

## Consequences

- A Card's Reviews can shrink, so nothing may cache a count of them or treat a Review's ID as permanent.
- Undoing a Review whose Deck's Desired retention changed since it was given reschedules the restored state at the current retention, as any change of retention does.
