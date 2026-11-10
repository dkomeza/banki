# New Parameters replay memory states and keep due dates

A Card's memory state, and the one each of its Reviews keeps from before it for Undo, are what FSRS worked out under the Parameters in use at the time. When a Tuning or a Reset to defaults applies new Parameters, Banki replays every Card's Reviews (since its newest Progress reset, in the Write order; ADR-0026) from New under the new Parameters, in the same transaction that stores them, and rewrites the Card's memory state and each Review's state from before it. Live and deleted Cards are replayed; Removed ones have no Card to replay. The Card's due date and Interval stay as they were: the new Parameters decide its next Interval at its next Rating, and the Queue's Predicted recall uses them at once. Tuning runs by itself every 200 Reviews, without the User's involvement, so moving due dates each time would pile Cards onto a day the User never chose.

## Considered Options

- **Replay and reschedule**, as a change of Desired retention does (BAN-23): due dates would always match the model, but any automatic Tuning could move many Cards' due dates at once, a batch of them onto today.
- **No replay**: the new Parameters would apply only from each Card's next Rating, from a state the old ones worked out, so every Card would mix two models, against FSRS's guidance to recompute states.

## Consequences

- Unlike a Desired retention, the Parameters don't keep every due date current: a Card's due date may follow the Parameters before the last change until its next Rating.
- Undo after a Tuning restores the replayed state from before the undone Review, so it stays consistent with the current Parameters.
- Replaying under unchanged Parameters must change nothing; a test holds it.
- A change of Desired retention after a Tuning reschedules from the replayed states, under the current Parameters.
