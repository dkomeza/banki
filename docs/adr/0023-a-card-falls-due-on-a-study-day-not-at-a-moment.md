# A Card falls due on a Study day, not at a moment

FSRS schedules in days. A Card it sends N days out is due from the Day start of the Study day N days after its Review, not at exactly N×24 hours after it, so a Card reviewed at 23:00 with a one-day interval is in the next morning's Session, and the due count doesn't drift with the time of day. We still store the due moment as a timestamp and work out its Study day when it is read, with the current Timezone and Day start (ADR-0010). Learning steps, minutes long, are the exception: a Card in them is due at its exact moment.

## Considered Options

- **Due at the exact moment**: simpler to query, but whether a Card is due tomorrow would depend on the hour it was reviewed today, which the User can't see.

## Consequences

- "Due today" means due before the next Day start, so every due query needs the Timezone and Day start, as per-day queries already do.
- Changing the Timezone or Day start can move a Card's due day, as it moves past Reviews between Study days.
