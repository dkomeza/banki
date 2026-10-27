# Removing a Card never removes its Reviews

Reviews of deleted Cards still count in history and statistics, and that holds after Removal too, 30 days after a Card's delete or sooner when the User deletes it permanently. Removal deletes the Card's row, but never its Reviews: they stay for good, naming a Card, and a Deck, that may no longer exist. So statistics and FSRS tuning never shift because a Deletion's 30 days ran out, and a deleted Card's history isn't quietly lost a month after the delete.

## Considered Options

- **Remove the Reviews with the Card**: no Review would ever name a missing Card, but global statistics would drop history 30 days after every delete, with nothing on screen to say why.

## Consequences

- A Review keeps the IDs of its Card and Deck without a foreign key that cascades, and whatever reads Reviews (statistics, FSRS tuning) has to cope with a Card or Deck that is gone.
- Per-deck statistics of a removed Deck are no longer reachable, while its Reviews still count in the global ones.
