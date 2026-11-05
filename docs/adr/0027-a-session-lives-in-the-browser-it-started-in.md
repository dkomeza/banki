# A Session lives in the browser it started in

A Session (its counters, its New-card batches, the Card it shows and the Ratings Undo and the summary need) is saved in the browser's storage, one per Deck, and resumes only there. The API stays stateless: `study/next` and `study/overview` take the Session's counters as they always have. Resume is for an interrupted sitting (a reload, a closed tab, a step away), which happens on one device, and keeping the Session in the browser leaves the Queue, Ratings and Undo as they are.

## Considered Options

- **The server owns the Session**: a session table, with Reviews carrying its ID. A Session would resume on any device and the counters couldn't be lost with the browser's storage, but `study/next`, the Rating and Undo would all move from a stateless API to one that tracks a Session.

## Consequences

- Studying a Deck on a second device starts a Session of its own there, with a New-card batch of its own.
- Clearing the browser's storage, or storage the browser refuses, loses the open Session: the next one starts fresh. Nothing is lost on the server, since every Rating is already saved.
- Two tabs on one Deck share the stored Session, and the one acted in last wins.
- Nothing on the server knows a Session's bounds, so statistics that need Sessions later would need this decision revisited.
