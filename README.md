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

The API restarts its whole process on a change rather than hot-reloading (`bun --hot`), because startup opens the database, applies migrations and installs signal handlers, and a hot reload would repeat that inside the old process.

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

On startup the API creates whatever is missing, then applies any migrations the database doesn't have yet before it accepts requests.

To back up Banki, stop the API first and then copy the whole directory, or take an atomic snapshot of the filesystem it lives on. Copying it while the API runs can catch `banki.db` and `banki.db-wal` at different moments and give a backup that doesn't match either.

## Running with Docker

To self-host Banki, run it with Docker Compose from a clone of this repo:

```sh
docker compose up -d
```

That builds two images and starts them behind one origin: `web` (Caddy) serves the app and passes everything under `/api` to `api` (the Bun API). Only `web` is reachable from the host, on port 8080, so open <http://localhost:8080>. Docker reports `api` healthy once `/api/health` answers, and `web` starts only after that.

To use another port, set `BANKI_PORT` in a `.env` file next to `compose.yaml` (it defaults to 8080):

```sh
BANKI_PORT=9000
```

The port is open on every network interface of the host. To make Banki reachable only from the host itself, for example when a reverse proxy on the same machine sits in front of it, prefix the port with `127.0.0.1:`, as in `BANKI_PORT=127.0.0.1:8080`.

### HTTPS

The web container speaks plain HTTP only. For HTTPS, put your own reverse proxy (Caddy, nginx, Traefik and so on) in front of it to terminate TLS. Browsers only offer to install Banki as an app (a PWA) over HTTPS or on `localhost`.

### Where the data lives

Everything Banki stores is in the `banki-data` volume, mounted at `/data` in the `api` container (see [API configuration](#api-configuration) for its layout). Compose names it `banki_banki-data`, and `docker volume inspect banki_banki-data` shows where it is on the host. It survives restarts, rebuilds and `docker compose down`; only `docker compose down -v` deletes it. To back it up, follow the note under [API configuration](#api-configuration), stopping the API with `docker compose stop api` first.

To keep the data in a directory of your own instead (a bind mount), make the directory owned by uid 1000 first, since the API runs as that user and can't write to it otherwise:

```sh
mkdir -p /srv/banki
sudo chown 1000:1000 /srv/banki
```

Then mount it over `/data` in a `compose.override.yaml` next to `compose.yaml`, which Compose reads automatically:

```yaml
services:
  api:
    volumes:
      - /srv/banki:/data
```

### Upgrading

```sh
git pull && docker compose up -d --build
```

That rebuilds both images and recreates the containers. The API applies any new migrations on start, before it accepts requests, and the data volume stays as it is.

### Checking the Docker setup

Two scripts check the images and the stack. Both run on demand only, not in CI.

| Script                  | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `bun run smoke:docker`  | Builds both images for this machine under their own throwaway tags, leaving any `banki-api` and `banki-web` you run untouched, and starts the stack under a throwaway project on a free port. Through the web port only, it checks the app, a deep link, health, the API's 404, asset caching, non-root users, a restart and a clean stop. Then it removes the stack, its volume and its images, also when a check fails or it gets SIGINT or SIGTERM. |
| `bun run docker:buildx` | Builds both images for `linux/amd64` and `linux/arm64` without loading them. It needs a buildx builder that can build for several platforms; if yours can't, create one with `docker buildx create --use`.                                                                                                                                                                                                                                             |

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
