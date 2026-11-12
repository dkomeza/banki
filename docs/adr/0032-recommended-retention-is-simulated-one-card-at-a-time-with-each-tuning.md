# Recommended retention is simulated one Card at a time, with each Tuning

Neither FSRS library Banki uses can work out a Recommended retention: `@open-spaced-repetition/binding` 0.5.0 exposes no simulator, and `ts-fsrs` 6.0.0 has none. So Banki simulates in its own TypeScript. It simulates a year of study under the User's Parameters, with their own time per Card-day and Rating mix, and picks the whole percent from 70 to 97 that leaves the most Cards remembered at the end per minute studied. Banki sets no daily limits, so Cards never compete for a day's time and each one is simulated on its own. The simulation is seeded, so the same inputs give the same answer. It runs right after each Tuning log row, inside the same one-at-a-time operation per User. The result is stored on that row, so the current Recommended retention is the newest row's. A Reset to defaults gives none, because a recommendation from FSRS's defaults would be the same generic number for everyone.

## Considered Options

- **Port fsrs-rs's simulator whole**, with its daily cost and new-card limits: it is closer to Anki's former "compute minimum recommended retention", but those limits model a constraint Banki doesn't have, at many times the cost.
- **Wait for the library to expose it**: nothing schedules that, and the issue wants the recommendation now.
- **Work it out on demand when a screen asks**: every visit to Settings would pay for a simulation, and the recommendation would drift between visits with no Tuning to explain it.

## Consequences

- The recommendation changes only when a Tuning runs: every 200 Reviews, or on Tune now. A User whose last Tuning predates this ADR has none until their next one.
- The objective often lands at 70–80%. Banki shows it as it is, across the whole Desired retention range, with no floor.
- Per-Deck Parameters (BAN-55) give a Deck its own recommendation, stored on its own Tuning row and worked out the same way.
