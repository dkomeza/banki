# Study days are derived from timestamps, not stored

Everything Banki counts per day (due cards, daily minutes, statistics) groups moments into Study days, which run from one Day start to the next in the User's Timezone. We store only when something happened and work out its Study day whenever it is read, with the current Timezone and Day start, rather than fixing a Study day on each review when it is written. One source of truth means no stored date can disagree with the settings or be written wrong for good.

## Consequences

- Changing the Timezone or the Day start moves past reviews between Study days, so statistics can shift after a change or a trip. Anki behaves the same way.
- Per-day queries need the Timezone and the Day start, so they take them from the User's Settings rather than from the server's clock or the browser.
