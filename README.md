# Banki

A spaced-repetition app built around writing answers and having an LLM grade them.

## Prerequisites

- [Bun](https://bun.sh) 1.4.3 (pinned in `package.json` under `packageManager`)
- [Node.js](https://nodejs.org) 24 (pinned in `.node-version`), which runs Vite and Vitest

## Getting started

```sh
bun install
bun run dev
```

`dev` starts the API on <http://localhost:3000> (`bun --watch`, restarting on changes) and the web app on <http://localhost:5173> (Vite), which proxies `/api` to the API. Open <http://localhost:5173>.

In dev the API keeps its data in `apps/api/.data/` and logs in pretty text. Delete that folder to start over with an empty database. It is gitignored, as are all SQLite files.

## API configuration

The API reads these environment variables at startup and exits with code 1, listing what's wrong, if any is invalid. An empty variable counts as unset.

| Variable     | Default | What it sets                                                                                 |
| ------------ | ------- | -------------------------------------------------------------------------------------------- |
| `DATA_DIR`   | `/data` | The data directory. A relative path is resolved against the working directory.               |
| `PORT`       | `3000`  | The port the API listens on, 1 to 65535                                                      |
| `LOG_FORMAT` | `json`  | `json` for JSON lines, `pretty` for terminal-friendly text                                   |
| `LOG_LEVEL`  | `info`  | The lowest level logged: `debug`, `info`, `warning` or `error`. Health checks log at `debug` |

The data directory holds everything Banki stores:

```text
<DATA_DIR>/
├── banki.db   SQLite database (with banki.db-wal and banki.db-shm beside it while running)
└── uploads/   uploaded files (nothing uses it yet)
```

On startup the API creates whatever is missing, then applies any migrations the database doesn't have yet before it accepts requests. Back up the whole directory to back up Banki.

## Database migrations

The schema lives in `apps/api/src/db/schema.ts`, and the migrations drizzle-kit generates from it live in `apps/api/drizzle/` (SQL files plus `meta/`, all committed). To change the schema:

1. Edit `apps/api/src/db/schema.ts`.
2. Run `bun run db:generate` in `apps/api` and commit the new migration with the schema change.
3. Restart the API, which applies it.

CI runs `db:generate` too and fails if it would change any file, so a schema change without its migration can't be merged.

## Layout

| Workspace       | Path              | What it is                                                      |
| --------------- | ----------------- | --------------------------------------------------------------- |
| `@banki/api`    | `apps/api`        | Hono API on Bun, every route under `/api`                       |
| `@banki/web`    | `apps/web`        | React SPA: Vite, TanStack Router and Query, Tailwind, shadcn/ui |
| `@banki/shared` | `packages/shared` | Runtime-agnostic contracts (zod schemas) shared by both apps    |

## Checks

Run from the repo root; CI runs the same ones.

| Script                 | What it does                                                   |
| ---------------------- | -------------------------------------------------------------- |
| `bun run typecheck`    | `tsc -b` across every workspace                                |
| `bun run lint`         | oxlint, type-aware, warnings fail                              |
| `bun run format`       | oxfmt, rewriting files in place                                |
| `bun run format:check` | oxfmt, failing on unformatted files                            |
| `bun run test`         | Each workspace's tests: `bun test` (api, shared), Vitest (web) |
