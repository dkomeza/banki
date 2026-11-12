# A Plan is a row of its own, and its Deadline is a Study day

A Deck's Plan lives in a `plan` table, one row per Deck for now, rather than as columns on `deck` the way its Desired retention and Answer mode do. Its Deadline is stored as the Study day's date (`YYYY-MM-DD`), not as a moment, and read with the current Timezone and Day start like everything per day (ADR-0010, ADR-0024). Several Plans per Deck, a Plan's prediction history and the summary of an ended Plan all need a Plan to be something rows can point at, and an exam is on a day, not at an hour.

## Considered Options

- **Columns on `deck`** (`plan_deadline`, `plan_daily_minutes`): simplest for one Plan, but a second Plan, the forecast's history and an ended Plan's summary would each need it moved into a table later, with a migration of live data.
- **The Deadline as a timestamp** (its Day start): consistent with how a Card's due moment is stored, but a change of Timezone or Day start would move the exam to another day, or need rewriting every Plan.

## Consequences

- One Plan per Deck is a unique index on `deck_id`, which several Plans later drop or narrow.
- A Deck's delete leaves its Plan in place and a Restore brings it back; a Removal deletes it with the Deck.
- Whatever counts days to the Deadline computes them from Study days with the current settings, as due counts do.
