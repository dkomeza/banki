# Bun as the server runtime

The API runs on Bun, not Node. Bun gives us built-in SQLite (`bun:sqlite`, which stable Drizzle supports, whereas `node:sqlite` is still experimental on Node 24), a built-in test runner, and less tooling to maintain. The FSRS optimizer binding (`@open-spaced-repetition/binding`) was verified to work under Bun. To keep the way back to Node open, we use runtime-portable libraries where it matters (Hono for the server). The parts that are tied to Bun are `bun:sqlite` and `bun test`, and both live only in `apps/api`.
