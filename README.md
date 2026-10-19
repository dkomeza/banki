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

### First run

Until Setup is done, Banki does nothing else. On every start while no User exists, the API logs a fresh Setup token at `warning`, with a link to Setup on `ORIGIN` such as `http://localhost:5173/setup?token=…`. Open that link and pick the Email and Password you'll sign in with. The token proves you can see the server's logs, so a stranger who reaches a fresh installation first can't claim it. A restart replaces it, and Setup discards it.

After Setup, everything except `/api/health`, `/api/setup` and signing in needs a signed-in browser. Signing in lasts 30 days, moving forward each day you use Banki, until you sign out.

### Setting up from a shell

`banki setup` does Setup without the Setup page: headless Setup, for scripts, Previews and anyone with a shell on the server. Run it before the API starts, or while it waits for Setup (the Setup page then answers that Banki is already set up). In `apps/api`, against the dev data directory:

```sh
DATA_DIR=.data bun run banki setup
```

It asks for the Email, then for the Password twice with hidden input, asking again until both match and are valid. `--email you@example.com` skips the Email question. For scripts, `--email` with `--password-stdin` reads the Password from the first line of stdin instead, without asking:

```sh
printf '%s\n' "$PASSWORD" | DATA_DIR=.data bun run banki setup --email you@example.com --password-stdin
```

The Password never goes on the command line or in the environment. Setup from a shell needs no Setup token: a shell on the server proves at least as much. It refuses when Banki is already set up, and changes nothing. Like every `banki` command, it reads the same configuration as the API, applies any pending migrations, and creates the data directory if it is missing. For Docker, see [Setting up from a shell in Docker](#setting-up-from-a-shell-in-docker).

### Seed data

`banki seed` loads the Seed data: fixed sample content, the same on every run, for development and Previews. It only runs on an installation that is set up and whose User has no content yet, so it can't touch a real installation's cards:

```sh
DATA_DIR=.data bun run banki seed
```

To start a local copy set up and seeded, delete `apps/api/.data/`, then run `banki setup` and `banki seed` before `bun run dev`.

### Resetting the Password

There's no email to send a reset link to, so a forgotten Password is reset from the command line. In `apps/api`, against the dev data directory:

```sh
DATA_DIR=.data bun run banki reset-password
```

It prints the User's Email, asks for the new Password twice, sets it and signs out every device. `--password-stdin` reads the Password from one line of stdin instead, without asking twice, for scripts. It reads the same configuration as the API (so set `DATA_DIR` the way the API has it) and works while the API runs. For Docker, see [Resetting the Password in Docker](#resetting-the-password-in-docker).

## API configuration

The API reads these environment variables at startup and exits with code 1, listing what's wrong, if any is invalid. An empty variable counts as unset.

| Variable      | Default                 | What it sets                                                                                                                                                                                                                                 |
| ------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATA_DIR`    | `/data`                 | The data directory. A relative path is resolved against the working directory.                                                                                                                                                               |
| `PORT`        | `3000`                  | The port the API listens on, 1 to 65535                                                                                                                                                                                                      |
| `LOG_FORMAT`  | `json`                  | `json` for JSON lines, `pretty` for terminal-friendly text                                                                                                                                                                                   |
| `LOG_LEVEL`   | `info`                  | The lowest level logged: `debug`, `info`, `warning` or `error`. Health checks log at `debug`                                                                                                                                                 |
| `ORIGIN`      | `http://localhost:5173` | The address the User opens Banki at: an `http:` or `https:` URL with no path, query or hash. Signing in is refused from any other origin, and the sign-in cookie is `Secure` exactly when it is `https:`. The default is the Vite dev server |
| `AUTH_SECRET` | none                    | The secret sign-in cookies are signed with, at least 32 characters. Unset, the API generates one into `<DATA_DIR>/auth-secret` on the first start. Changing it signs out every device                                                        |

The data directory holds everything Banki stores:

```text
<DATA_DIR>/
├── banki.db      SQLite database (with banki.db-wal and banki.db-shm beside it while running)
├── auth-secret   the secret sign-in cookies are signed with, unless AUTH_SECRET is set (mode 0600)
└── uploads/      uploaded files (nothing uses it yet)
```

On startup the API creates whatever is missing, then applies any migrations the database doesn't have yet before it accepts requests. An `auth-secret` that is empty, shorter than 32 characters or unreadable fails startup; delete it to generate a new one, which signs out every device.

To back up Banki, stop the API first and then copy the whole directory, or take an atomic snapshot of the filesystem it lives on. Copying it while the API runs can catch `banki.db` and `banki.db-wal` at different moments and give a backup that doesn't match either. A backup includes `auth-secret`, so keep it as private as the installation itself.

## Running with Docker

To self-host Banki, run it with Docker Compose from a clone of this repo:

```sh
docker compose up -d
```

That builds two images and starts them behind one origin: `web` (Caddy) serves the app and passes everything under `/api` to `api` (the Bun API). Only `web` is reachable from the host, on port 8080, so open <http://localhost:8080>. Docker reports `api` healthy once `/api/health` answers, and `web` starts only after that.

On the first run, find the Setup link in the API's logs and open it (see [First run](#first-run)):

```sh
docker compose logs api | grep setupUrl
```

The link is on `BANKI_ORIGIN`, so it only works once that is right for you (below). If you open Banki at another address, take the token from the link and paste it into the Setup page.

Never publish the API's port (no `ports:` for `api` in a `compose.override.yaml`). The API trusts the `X-Forwarded-For` header for client IPs, in its rate limits and logs, because only `web` can reach it.

To use another port, set `BANKI_PORT` in a `.env` file next to `compose.yaml` (it defaults to 8080):

```sh
BANKI_PORT=9000
```

The port is open on every network interface of the host. To make Banki reachable only from the host itself, for example when a reverse proxy on the same machine sits in front of it, prefix the port with `127.0.0.1:`, as in `BANKI_PORT=127.0.0.1:8080`.

### The address you open Banki at

Banki refuses to sign in from any address but `BANKI_ORIGIN` (the API's `ORIGIN`), which defaults to `http://localhost:8080`. Set it in `.env` to the exact address in your browser's address bar, without a path, whenever that isn't `http://localhost:8080`: when you open Banki by another host name or IP, on a different `BANKI_PORT`, or through an HTTPS reverse proxy:

```sh
BANKI_PORT=9000
BANKI_ORIGIN=http://192.168.1.20:9000
```

```sh
# Behind your own HTTPS proxy
BANKI_ORIGIN=https://banki.example.com
```

With an `https:` origin the sign-in cookie is `Secure`. A sign-in from the wrong address fails, and the API logs a warning naming both addresses.

### HTTPS

The web container speaks plain HTTP only. For HTTPS, put your own reverse proxy (Caddy, nginx, Traefik and so on) in front of it to terminate TLS, and set `BANKI_ORIGIN` to its `https://` address. Browsers only offer to install Banki as an app (a PWA) over HTTPS or on `localhost`.

Banki limits sign-in and Setup attempts per client IP. Behind your own proxy every request comes from the proxy's address, so tell `web` to believe the `X-Forwarded-For` your proxy sends by listing the proxy's IPs or CIDR ranges, space-separated, in `BANKI_TRUSTED_PROXIES`:

```sh
BANKI_TRUSTED_PROXIES=172.18.0.1 10.0.0.0/24
```

List only your proxies, never a broad private range that also covers clients. Unset, `web` trusts no one and uses the address each connection comes from.

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

### Setting up from a shell in Docker

Instead of opening the Setup link, run `banki setup` in a one-off `api` container before the first `docker compose up`, against the empty volume:

```sh
printf '%s\n' "$PASSWORD" | docker compose run --rm -T api bun run banki setup --email you@example.com --password-stdin
docker compose up -d
```

Or interactively, answering its questions: `docker compose run --rm api bun run banki setup`. The API then starts set up and logs no Setup token. See [Setting up from a shell](#setting-up-from-a-shell). `docker compose run --rm -T api bun run banki seed` loads the [Seed data](#seed-data) the same way.

### Resetting the Password in Docker

```sh
docker compose exec -it api bun run banki reset-password
```

Or, from a script, `printf '%s\n' "$NEW_PASSWORD" | docker compose exec -T api bun run banki reset-password --password-stdin`. Either way it signs out every device. See [Resetting the Password](#resetting-the-password).

### Upgrading

```sh
git pull && docker compose up -d --build
```

That rebuilds both images and recreates the containers. The API applies any new migrations on start, before it accepts requests, and the data volume stays as it is.

### Checking the Docker setup

Two scripts check the images and the stack. Both run on demand only, not in CI.

| Script                  | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run smoke:docker`  | Builds both images for this machine under their own throwaway tags, leaving any `banki-api` and `banki-web` you run untouched, and starts the stack under a throwaway project on a free port. Through the web port only, it checks the app, a deep link, health, the API's 401 and 404, asset caching, the security headers, Setup with the logged token, signing in and out, the client IP Caddy forwards (with and without `BANKI_TRUSTED_PROXIES`), non-root users, a restart, `reset-password --password-stdin`, that a second `banki setup` through `docker compose run --rm -T api` is refused and signing in still works, that `banki seed` succeeds the same way, and a clean stop. Then it removes the stack, its volume and its images, also when a check fails or it gets SIGINT or SIGTERM. |
| `bun run docker:buildx` | Builds both images for `linux/amd64` and `linux/arm64` without loading them. It needs a buildx builder that can build for several platforms; if yours can't, create one with `docker buildx create --use`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

### Preview images

For Previews, every push to a pull request from a branch of this repo builds both images for `linux/amd64` on GitHub's runners and pushes them to GHCR as `ghcr.io/<owner>/banki-api` and `ghcr.io/<owner>/banki-web` (`.github/workflows/preview-images.yml`). The home server only pulls them, so no PR code runs there outside a Preview container. Each push adds one version per package, tagged:

| Tag            | What it marks                                                                            |
| -------------- | ---------------------------------------------------------------------------------------- |
| `pr-<N>`       | The newest push to PR `<N>`; it moves on every push                                      |
| `sha-<sha>`    | The push of the PR's head commit `<sha>` (the full SHA), which the home server waits for |
| `pr-<N>-<sha>` | The same push, so every version PR `<N>` ever pushed can be found by its PR              |

When a PR closes, cleanup sweeps both packages and deletes every version of every PR that is no longer open: a version with a `pr-<M>` or `pr-<M>-…` tag whose PR `<M>` is closed, and with no tags but `pr-…` and `sha-…` ones. A version with any other tag, such as a release's `v1.0.0` or `latest`, is never touched. GHCR refuses to delete a package's last tagged version, so when a closed PR's version is the only one left, it stays until a later cleanup sweeps it after another PR has pushed, or for good once a release version lives in the same package. Pull requests from forks and Dependabot get no images.

Both packages start out private. Make each one public once, after its first push (on GitHub: the package's **Package settings**, then **Change visibility**), so the home server can pull them without credentials.

`GET /api/health` reports the commit its image was built from as `commit`: the full SHA in a preview image, and `"dev"` in local dev and in images built locally, such as with `docker compose`.

## Database migrations

The schema lives in `apps/api/src/db/schema.ts`, and the migrations drizzle-kit generates from it live in `apps/api/drizzle/` (SQL files plus `meta/`, all committed). To change the schema:

1. Edit `apps/api/src/db/schema.ts`.
2. Run `bun run db:generate` in `apps/api` and commit the new migration with the schema change.
3. Restart the API, which applies it.

CI runs `db:generate` too and fails if it would change any file, so a schema change without its migration can't be merged.

better-auth's tables (`user`, `auth_session`, `auth_account`, `auth_verification`) live in `apps/api/src/db/auth-schema.ts`, generated from the auth options in `apps/api/src/auth/auth.ts`. After changing those options, or upgrading better-auth, run `bun run auth:generate` in `apps/api`, then `bun run db:generate` for the migration.

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
