# Banki

A spaced-repetition app built around writing answers and having an LLM grade them.

## Prerequisites

- [Bun](https://bun.sh) 1.4.3 (pinned in `package.json` under `packageManager`)
- [Node.js](https://nodejs.org) 24 (pinned in `.node-version`), which runs Vite, Vitest and the [`ui` script](#seeing-the-ui-the-ui-script)

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

`banki seed` loads the Seed data: fixed sample content, the same on every run, for development and Previews. So far it is the User's Timezone, `Europe/Warsaw`, stored only while no Timezone is (a signed-in load may already have stored the browser's). It only runs on an installation that is set up and whose User has no content yet, so it can't touch a real installation's cards:

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

## Seeing the UI: the `ui` script

`bun run ui` starts a throwaway copy of Banki in this worktree and screenshots it, so you, and the `/work-issue` agents, can see the screens a change touches. The copy (the stack) is the API and Vite on free ports, already set up with a local throwaway User (Email `asdf@asdf.asdf`, Password `asdfasdf`, so you can sign in to it by hand), loaded with the [Seed data](#seed-data) and signed in. Its data directory is `.ui/data-<id>/`, never `apps/api/.data/`, so it leaves your own dev data alone, and stacks in several worktrees run side by side. Everything it writes is under `.ui/`, which is gitignored.

It runs on Node (Playwright doesn't support Bun) and drives Playwright's own Chromium, which you install once:

```sh
npx playwright install chromium
```

Without it, the script stops and prints that command.

### `ui shoot`

```sh
bun run ui shoot / /login /setup
bun run ui / /decks/abc          # shoot is the default
bun run ui '/decks/$deckId'      # a route with params, at its path from the route manifest
```

Starts a fresh stack, opens each route as given, waits until the network is idle and the fonts have loaded, and saves a full-page screenshot at three sizes:

| Viewport  | Size       | Emulates                                      |
| --------- | ---------- | --------------------------------------------- |
| `phone`   | 390 × 844  | a touch device (`isMobile`, `hasTouch`) at 2x |
| `tablet`  | 820 × 1180 | a touch device (`isMobile`, `hasTouch`) at 2x |
| `desktop` | 1440 × 900 | a desktop browser at 1x                       |

Each route is shot in its mode from the [route manifest](#the-route-manifest): `/login` signed out, `/setup` before Setup, and every other route signed in. A route with params, such as `/decks/$deckId`, is shot at the one concrete path its manifest entry gives, and one with no entry is refused, naming it. Signed-in and signed-out routes share one stack; a stack waiting for Setup starts too only when a route needs one.

The shots go to `.ui/shots/<agent>/<route>@<viewport>-<theme>.png`. In the file name `/` is `index`, the leading slash goes, other slashes become `_`, and the query string and hash are dropped: `/decks/abc?tab=cards` is `decks_abc@phone-light.png`. Then it stops the stack and deletes its data directory, also when a step fails or you press Ctrl-C. It never touches a stack from `ui up`.

| Flag             | What it does                                                                                   |
| ---------------- | ---------------------------------------------------------------------------------------------- |
| `--agent <name>` | The folder under `.ui/shots/`. Defaults to `manual`                                            |
| `--signed-out`   | Every route set up and seeded, but not signed in, whatever the manifest says                   |
| `--before-setup` | Every route not set up, no Seed data, and the API waits for Setup (opened with no Setup token) |

Every browser the script opens is in the Seed data's Timezone, `Europe/Warsaw` (`SEED_TIMEZONE`, in `apps/api/src/seed/seed-ids.ts`), whatever the machine's zone, so shots don't change with it and Settings never shows its timezone mismatch hint.

Every stack seeds at one fixed time, `SEED_NOW` (in the same file, passed to `banki seed` as `BANKI_SEED_NOW`), and the browsers `ui shoot` and `ui compare` open run on a clock fixed at it, so a time or a day shown relative to now, such as a Card's "Today, 11:00" on the deck page, is the same in every shot. A browser you drive with `playwright-cli` keeps the real clock.

Each viewport is shot in the light theme and in the dark one. The dark shots emulate `prefers-color-scheme: dark` with no theme stored, so the web app's default, System, shows dark. The switch is in `apps/web/package.json`:

```json
"banki": { "darkTheme": true }
```

With it `false`, dark shots are skipped.

### The route manifest

`scripts/ui/routes.ts` says how to shoot each route of the web app's route tree, keyed by its full path as `apps/web/src/routeTree.gen.ts` names it:

```ts
export const ROUTES: RouteManifest = {
  "/login": { mode: "signed-out" },
  "/setup": { mode: "before-setup" },
};
```

A route with params, or with content that differs on every run, gets an entry like one of these. Both routes are made up, to show the shape:

```ts
  "/decks/$deckId": { path: `/decks/${SEED_IDS.deck}` },
  "/some-route": { mask: [".measured-latency"] },
```

- `mode`: `signed-out` or `before-setup`. A route without one is shot signed in.
- `path`: the one concrete path to shoot a route with params at, built from the [Seed data](#seed-data)'s fixed IDs (`SEED_IDS`, in `apps/api/src/seed/seed-ids.ts`). Every route with params needs one.
- `mask`: CSS selectors of content that differs on every run, such as a measured latency or random content. Every shot of the route, in `ui shoot` and on both sides of `ui compare`, hides them (`visibility: hidden`, through Playwright's screenshot `style`): they keep their place on the page but draw nothing, so they never count as a change, whatever their size.

An issue that adds a routed screen with params or a sign-in mode adds its entry, with any fixed ID it needs in `SEED_IDS`, and a screen with content that differs on every run masks it.

### `ui compare`

```sh
bun run ui compare
bun run ui compare --body pr-body.md
```

Shows a PR's visual change: it shoots every route on the branch and on its merge-base with `main`, keeps the routes a pixel diff finds changed, and writes their before and after shots to `.ui/pr/` with a markdown fragment, `.ui/pr/evidence.md`. `/work-issue` puts it in the PR body.

- **Base:** it runs `git fetch origin main` (only warning if that fails), and checks out `git merge-base HEAD origin/main` in a detached worktree at `../banki-worktrees/.base-<12-char sha>`, next to the main checkout, so every worktree with the same merge-base shares it. Each run creates it if it is missing and runs `bun install --frozen-lockfile` in it, under a lock: two runs on the same base take turns. `/work-issue`'s step 0 removes these worktrees.
- **After:** this worktree as it is, uncommitted changes included.
- **Routes:** each side's leaf routes from its `routeTree.gen.ts` (pathless layouts left out), all shot as `ui shoot` shoots them, with this branch's route manifest (paths, modes and masks) and themes for both sides. A route only on the branch is **new**, and one only on the base is **removed** (and not shot). The base side runs first, then the branch side.
- **Diff:** [`pixelmatch`](https://github.com/mapbox/pixelmatch) at a 0.1 threshold, ignoring anti-aliasing. A route has **changed** when any of its pairs has a differing pixel, or differs in size; its score is the largest fraction of differing pixels across them.

The fragment sits between `<!-- ui-shots -->` and `<!-- /ui-shots -->`. Each changed route gets an `#### /route` heading and a table, Phone, Tablet and Desktop by Before and After, with the dark one (once there is a dark theme) in a collapsed `<details>`; a new route gets an After column only. Removed and unchanged routes get a line each, and with nothing changed, new or removed the section says "No visual changes". The images are referenced as `./.ui/pr/<route>@<viewport>-<theme>-<before|after>.png`, which `gh pr create --attach` (or `gh pr edit --attach`) rewrites to the uploaded files when run from the worktree's root.

`gh` attaches at most 50 files, so `.ui/pr/*.png` never holds more: new routes first, then changed routes by descending score, each whole route while it still fits. The rest are named on an "Also changed (not shown)" line. Each run empties `.ui/pr/` first, and prints the fragment's path and the number of files to attach.

`--body <file>` also puts the fragment into a PR body file: in place of what is between the markers, or, without them, at the top of its `## Evidence` section, or in a new `## Evidence` section after `## Summary` (or at the end).

When the base side fails anywhere (the worktree, the install, its route tree, Setup, Seed data, a server or a shot), `ui compare` still exits 0, with after-only shots of every route under a note: "No before shots: the base `<sha>` couldn't start (<reason>). After only." When the branch side fails, it exits non-zero: the branch is broken. A route with params and no manifest `path` fails it too, naming the route.

### `ui up` and `ui down`

For states that only appear after interaction, such as a validation error or a dialog, start a stack that keeps running:

```sh
bun run ui up                    # set up, seeded and signed in
bun run ui up --before-setup     # waiting for Setup
bun run ui down
```

`up` starts the stack in the background, with the API under `bun --watch` so it restarts when you change its code (Vite reloads the web app as usual), and writes `.ui/stack.json`: the URL, both ports and PIDs, the data directory, the logs, and either `signedInState` (a Playwright storage state of a signed-in browser) or, with `--before-setup`, `setupUrl` (the link to Setup with its Setup token). Running `up` again reuses the stack when it is in the same mode, and fails with a hint to run `ui down` first when it isn't. Two `up` (or `down`) runs at the same moment take turns: the second waits for the first, then reuses its stack. `down` stops the stack, deletes its data directory and removes `stack.json`. It also clears away every other `.ui/data-*` folder no `ui` run is still using, such as one left by a run that was killed, stopping first any stack still running from it (each stack records its processes in its data folder, so `down` finds it even when `stack.json` is lost). A running `ui shoot`'s folder is left alone. With nothing to clear, `down` does nothing.

Drive it with [`playwright-cli`](https://github.com/microsoft/playwright-cli), from the worktree's root, so it reads `.playwright/cli.config.json`: headless, on Playwright's Chromium, in the `Europe/Warsaw` timezone, with its output in `.ui/playwright-cli/`. Give each browser its own session with `-s=`:

```sh
npx --no-install playwright-cli -s=my-session open
npx --no-install playwright-cli -s=my-session state-load <signedInState from stack.json>
npx --no-install playwright-cli -s=my-session goto <url from stack.json>/decks
npx --no-install playwright-cli -s=my-session resize 390 844
npx --no-install playwright-cli -s=my-session snapshot
npx --no-install playwright-cli -s=my-session screenshot --filename=.ui/shots/manual/decks-empty.png
npx --no-install playwright-cli -s=my-session close
```

`npx --no-install playwright-cli --help` lists every command (`click`, `fill`, `press`, `set-color-scheme dark` and more).

## API configuration

The API reads these environment variables at startup and exits with code 1, listing what's wrong, if any is invalid. An empty variable counts as unset.

| Variable         | Default                 | What it sets                                                                                                                                                                                                                                                                    |
| ---------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATA_DIR`       | `/data`                 | The data directory. A relative path is resolved against the working directory.                                                                                                                                                                                                  |
| `PORT`           | `3000`                  | The port the API listens on, 1 to 65535                                                                                                                                                                                                                                         |
| `LOG_FORMAT`     | `json`                  | `json` for JSON lines, `pretty` for terminal-friendly text                                                                                                                                                                                                                      |
| `LOG_LEVEL`      | `info`                  | The lowest level logged: `debug`, `info`, `warning` or `error`. Health checks log at `debug`                                                                                                                                                                                    |
| `ORIGIN`         | `http://localhost:5173` | The address the User opens Banki at: an `http:` or `https:` URL with no path, query or hash. Signing in is refused from any other origin, and the sign-in cookie is `__Host-` (`Secure`, `Path=/`, no `Domain`) exactly when it is `https:`. The default is the Vite dev server |
| `AUTH_SECRET`    | none                    | The secret sign-in cookies are signed with, at least 32 characters. Unset, the API generates one into `<DATA_DIR>/auth-secret` on the first start. Changing it signs out every device                                                                                           |
| `ENCRYPTION_KEY` | none                    | The key the stored OpenRouter API key is encrypted with: 32 random bytes as base64url (43 characters). Unset, the API generates one into `<DATA_DIR>/encryption-key` on the first start. Changing it makes the stored API key unreadable, and it has to be entered again        |

The data directory holds everything Banki stores:

```text
<DATA_DIR>/
├── banki.db        SQLite database (with banki.db-wal and banki.db-shm beside it while running)
├── auth-secret     the secret sign-in cookies are signed with, unless AUTH_SECRET is set (mode 0600)
├── encryption-key  the key the API key is encrypted with, unless ENCRYPTION_KEY is set (mode 0600)
└── uploads/        the Images, byte for byte as uploaded, one file each (<id>.<ext>)
```

On startup the API creates whatever is missing, then applies any migrations the database doesn't have yet before it accepts requests. An `auth-secret` that is empty, shorter than 32 characters or unreadable fails startup; delete it to generate a new one, which signs out every device. An `encryption-key` that isn't 32 bytes as base64url, or is unreadable, fails startup too; delete it to generate a new one, after which the stored API key reads as "Can't be read" in Settings and has to be entered again. Nothing else is lost (ADR-0014).

To back up Banki, stop the API first and then copy the whole directory, or take an atomic snapshot of the filesystem it lives on. Copying it while the API runs can catch `banki.db` and `banki.db-wal` at different moments and give a backup that doesn't match either. A backup must keep `encryption-key` with `banki.db`: the API key in the database can only be read with it, so a database restored without it loses the API key. A backup includes `auth-secret` and `encryption-key`, so keep it as private as the installation itself.

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

Banki refuses to sign in from any address but `BANKI_ORIGIN` (the API's `ORIGIN`; `web` reads it too, for HSTS), which defaults to `http://localhost:8080`. Set it in `.env` to the exact address in your browser's address bar, without a path, whenever that isn't `http://localhost:8080`: when you open Banki by another host name or IP, on a different `BANKI_PORT`, or through an HTTPS reverse proxy:

```sh
BANKI_PORT=9000
BANKI_ORIGIN=http://192.168.1.20:9000
```

```sh
# Behind your own HTTPS proxy
BANKI_ORIGIN=https://banki.example.com
```

With an `https:` origin the sign-in cookie is `__Host-better-auth.session_token`, which is `Secure`, has `Path=/` and has no `Domain` (see [Sign-in cookies beside the Previews](#sign-in-cookies-beside-the-previews)), and `web` sends HSTS (see [Security headers](#security-headers)). A sign-in from the wrong address fails, and the API logs a warning naming both addresses.

### HTTPS

The web container speaks plain HTTP only. For HTTPS, put your own reverse proxy (Caddy, nginx, Traefik and so on) in front of it to terminate TLS, and set `BANKI_ORIGIN` to its `https://` address. Browsers only offer to install Banki as an app (a PWA) over HTTPS or on `localhost`.

Banki limits sign-in and Setup attempts per client IP. Behind your own proxy every request comes from the proxy's address, so tell `web` to believe the `X-Forwarded-For` your proxy sends by listing the proxy's IPs or CIDR ranges, space-separated, in `BANKI_TRUSTED_PROXIES`:

```sh
BANKI_TRUSTED_PROXIES=172.18.0.1 10.0.0.0/24
```

List only your proxies, never a broad private range that also covers clients. Unset, `web` trusts no one and uses the address each connection comes from.

### Security headers

`web` sends these on every response, the API's included:

- `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`: Banki loads nothing from anywhere but its own origin, and can't be framed.
- `X-Content-Type-Options: nosniff` and `Referrer-Policy: same-origin`.
- `Strict-Transport-Security: max-age=31536000`, only when `BANKI_ORIGIN` starts with `https://`, so browsers keep to HTTPS for a year. It leaves out `includeSubDomains` and `preload`, which would reach past Banki. Over plain HTTP it isn't sent.

`bun run dev` (Vite) sends none of them.

### Installing Banki as an app

Banki is a Progressive Web App: your browser can install it, so it opens in its own window, or from your home screen, like any other app. Browsers offer this only over HTTPS or on `localhost`. There is no Install button in Banki; use the browser's own:

- **Chrome or Edge on a computer:** the install icon at the right of the address bar, or the menu's Install page as app (Chrome: Cast, save and share).
- **Safari on a Mac:** File, Add to Dock.
- **Safari on an iPhone or iPad:** Share, Add to Home Screen.
- **Chrome on Android:** the menu's Add to Home screen, then Install.

Banki works online only: opened without a connection, the app shows the browser's own offline page. Its theme (System, Light or Dark, in the account menu) is kept per device.

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

| Script                  | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run smoke:docker`  | Builds both images for this machine under their own throwaway tags, leaving any `banki-api` and `banki-web` you run untouched, and starts the stack under a throwaway project on a free port. Through the web port only, it checks the app, a deep link, health, the API's 401 and 404, asset caching, the security headers (the full CSP everywhere, and no HSTS under the default http origin), the manifest's type and its PNG icons, that there is no service worker at `/sw.js`, that the web image started again alone with an `https://` `BANKI_ORIGIN` sends HSTS, Setup with the logged token, signing in and out, the client IP Caddy forwards (with and without `BANKI_TRUSTED_PROXIES`), non-root users, a restart, `reset-password --password-stdin`, that a second `banki setup` through `docker compose run --rm -T api` is refused and signing in still works, that `banki seed` succeeds the same way, and a clean stop. Then it removes the stack, its volume and its images, also when a check fails or it gets SIGINT or SIGTERM. |
| `bun run docker:buildx` | Builds both images for `linux/amd64` and `linux/arm64` without loading them. It needs a buildx builder that can build for several platforms; if yours can't, create one with `docker buildx create --use`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

### Preview images

For Previews, every push to a pull request from a branch of this repo builds both images for `linux/amd64` on GitHub's runners and pushes them to GHCR as `ghcr.io/<owner>/banki-api` and `ghcr.io/<owner>/banki-web` (`.github/workflows/preview-images.yml`). The home server only pulls them, so no PR code runs there outside a Preview container. Each push adds one version per package, tagged:

| Tag            | What it marks                                                                                                                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pr-<N>`       | The newest push to PR `<N>`; it moves on every push                                                                                                                                                     |
| `pr-<N>-<sha>` | The push of the PR's head commit `<sha>` (the full SHA). The pull agent waits for it and pulls by its digest, and cleanup finds every version PR `<N>` ever pushed by it, since only PR `<N>` pushes it |

When a PR closes, cleanup sweeps both packages and deletes every version of every PR that is no longer open: a version with a `pr-<M>` or `pr-<M>-…` tag whose PR `<M>` is closed, and with no tags but `pr-…` and `sha-…` ones (PR images were once tagged `sha-<sha>` too). A version with any other tag, such as a release's `v1.0.0` or `latest`, is never touched, and neither is a [main build](#main-images), which never has a `pr-<M>` tag. GHCR refuses to delete a package's last tagged version, and a public version downloaded more than 5000 times, so such a version stays: when a closed PR's version is the only one left, until a later cleanup sweeps it after another PR has pushed, or for good once a release version lives in the same package. Pull requests from forks and Dependabot get no images.

[Slug Previews](#slug-previews) push their images to the same two packages from the `slug-preview` workflow, each build tagged only `slug-<slug>-<sha>`, so PR cleanup never touches them. Their own sweep, after every `down` and once a day, deletes every version whose tags are all `slug-…` tags of Slugs that are down (the Slug's newest `slug-preview` deployment is inactive, or it has none), and never a version with any other tag. It keeps a package's last tagged version, as cleanup does.

### Main images

Every push to `main` builds both images for `linux/amd64` and `linux/arm64`, each natively on its own runner (`.github/workflows/main-images.yml`), and pushes them to the same two packages. Each platform image is pushed by digest, untagged; a merge job then joins each pair into one multi-arch manifest, tagged:

| Tag         | What it marks                                                                                      |
| ----------- | -------------------------------------------------------------------------------------------------- |
| `main`      | The newest build Edge deployed. It moves once the `edge` deployment is created, so never backwards |
| `sha-<sha>` | The build of `main`'s commit `<sha>` (the full SHA). Only main builds have `sha-…` tags            |

Once both manifests exist, the workflow creates an `edge` GitHub deployment of the commit, `queued` (`waiting for the agent`), whose payload holds the commit and the index digests of both images, `{ "sha", "api", "web" }`. The pull agent deploys [Edge](CONTEXT.md) from those digests, and [a Release](#releases) promotes the very same ones (ADR-0017). Edge never goes backwards: when the newest `edge` deployment is of a descendant of the commit, the build finished out of order and creates none, and leaves `main` where it is. No run is ever cancelled, so every commit gets its images, and the workflow doesn't wait for CI on `main`, since every PR passed CI before it merged.

To redeploy Edge, re-run a push's run of the workflow: it finds the images already pushed, skips the builds, and creates a fresh deployment with the same digests.

A sweep, once a day and on `gh workflow run main-images.yml`, keeps the ten newest main builds in each package, and always the one tagged `main`, and deletes the rest along with their platform manifests. A main build is a version whose tags are all `main` or `sha-…`; a version with any other tag, a Release's `v…`, the `v0.0.1` placeholder, a PR's or a Slug's, is never touched. It keeps what GHCR won't delete, as cleanup does. The untagged platform images of a merge job that failed are not swept.

Both packages start out private. Make each one public once, after its first push (on GitHub: the package's **Package settings**, then **Change visibility**), so the home server can pull them without credentials.

`GET /api/health` reports the commit its image was built from as `commit`: the full SHA in a preview or main image, and `"dev"` in local dev and in images built locally, such as with `docker compose`.

## Previews

A [Preview](CONTEXT.md) is either a **PR Preview**, of an open pull request, or a **Slug Preview**, of any branch, asked for by its Slug ([below](#slug-previews)). The two are separate pools, each with its own limits, and neither ever evicts the other's Previews.

Every open pull request from a branch of this repo gets a PR Preview at `https://pr-<N>.banki.dkomeza.com`, drafts included. It is already set up, with the Preview's Email and Password and the [Seed data](#seed-data). Every push rebuilds it from scratch from the [images CI pushes](#preview-images), with a fresh database, so you sign in again after a push. It's removed when the pull request closes or merges. Fork and Dependabot pull requests get none, the same rule CI uses for the images.

The home server runs other things too, so PR Previews are limited:

- **At most 5 run at once.** When a deploy would make a sixth, the Preview whose last deploy is the oldest is evicted first (a tie goes to the lower pull request number). Only a Preview with a running container counts, or one that is restarting or paused, since it still holds its place: one that failed, one stopped by hand, or what's left after a failed start doesn't. The pull request being deployed is never evicted.
- **Each is removed 7 days after its last deploy**, whatever its state, unless a newer push is still waiting for its images: that one deploys when they arrive.

An evicted or idle Preview comes back on its next push, as the newest. Closing and reopening the pull request doesn't bring it back; pushing does.

Each PR Preview shows on its pull request as a deployment to the `preview` environment:

| Status        | What it means                                                                                                                                                      |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `queued`      | Waiting for the push's images. There's no timeout: a failed image build shows on the pull request, and the next push moves things on                               |
| `in_progress` | Deploying                                                                                                                                                          |
| `success`     | Up, with the Preview's link                                                                                                                                        |
| `failure`     | Didn't start, with a short reason such as `seed exited 1`, `api not healthy after 60 s` or `health reports wrong commit …`. See below                              |
| `inactive`    | The pull request closed (`PR closed`), a newer push replaced it, or it was removed by the limits: `evicted, push to rebuild` or `idle for 7 days, push to rebuild` |

While a new push waits for its images, the Preview of the previous push keeps running.

### Slug Previews

A Slug Preview is a Preview of any branch of this repo, without a pull request: for example one per variant of a prototype ([ADR-0011](docs/adr/0011-slug-previews-dispatched-from-main-in-a-pool-of-their-own.md)). It lives at `https://<slug>.banki.dkomeza.com`, is set up with the same Email and Password and Seed data as a PR Preview, and runs the same way. Dispatch the `slug-preview` workflow from `main` (the default; `--ref <branch>` would run the branch's own copy of the workflow):

```sh
gh workflow run slug-preview.yml -f branch=proto/blue -f slug=blue
gh workflow run slug-preview.yml -f branch=proto/blue -f slug=blue -f ttl_hours=168
```

The workflow resolves the branch to its head now and builds that commit's images. The Slug Preview doesn't follow later pushes: dispatch it again to redeploy it at the branch's new head, from scratch. It refuses, before it builds or creates anything:

- a Slug that isn't 2 to 40 lowercase letters, digits and single hyphens, starting with a letter and ending with a letter or digit; one starting with `pr-`; and the reserved `www`, `api`, `app`, `admin`, `auth`, `mail`, `status`, `preview`, `previews`, `prod`, `production`, `staging` and `banki`;
- a branch that doesn't exist, and `dependabot/*` branches;
- a `ttl_hours` that isn't a whole number from 1 to 336;
- a Slug another branch holds: `slug <slug> is held by branch <branch>`. A Slug is held by the branch of its newest deployment until that one is inactive. Take it down first to give it to another branch.

Dispatching needs write access to the repo, and nothing more. Dispatches of one Slug never run at the same time: GitHub keeps one waiting behind the running one, and a newer dispatch replaces the one waiting.

Take a Slug Preview down with `down`, which needs no branch:

```sh
gh workflow run slug-preview.yml -f slug=blue -f down=true
```

That marks the Slug's newest deployment that isn't inactive yet `inactive` (`taken down`), and then sweeps the [images](#preview-images) of every Slug that is down. The agent tears the Preview down on its next loop, and the Slug is free again.

The workflow doesn't wait for the deploy: the pull agent reports on the Slug's deployment in the `slug-preview` environment, with the same statuses as a PR Preview's, `environment_url` set on a success. Read the newest one's state and link with `gh api`:

```sh
id="$(gh api 'repos/dkomeza/banki/deployments?environment=slug-preview&per_page=100' \
  --jq '[.[] | select(.payload.slug == "blue")] | max_by(.created_at) | .id')"
gh api "repos/dkomeza/banki/deployments/$id/statuses" --jq '.[0] | {state, description, environment_url}'
```

| Status        | What it means                                                                                                                                                                                                                                                  |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `queued`      | Claimed, and waiting for its images                                                                                                                                                                                                                            |
| `in_progress` | Deploying                                                                                                                                                                                                                                                      |
| `success`     | Up, with its link                                                                                                                                                                                                                                              |
| `failure`     | Didn't start: `build failed` from the workflow, `images never arrived, dispatch again` when its images still aren't there an hour after the dispatch, a reason from the agent as for a PR Preview, or `invalid slug` for a deployment the workflow didn't make |
| `inactive`    | Removed: `taken down`, `expired after <N> h, dispatch again to rebuild`, `evicted, dispatch again to rebuild`, or `superseded by a newer deploy` when the Slug was dispatched again                                                                            |

Slug Previews are limited apart from PR Previews:

- **Each is removed when its time to live runs out**: `ttl_hours` after it was dispatched, 72 by default and 336 (two weeks) at most. Dispatching it again starts it over.
- **At most 9 run at once**, with the same rules as the PR Previews' cap: a deploy that would make a tenth evicts the Slug Preview whose last deploy is the oldest first (a tie goes to the Slug first in the alphabet).
- **Each runs with less memory and CPU** than a PR Preview: api 128m and half a CPU, web 48m and a quarter, against 256m and 1 CPU, and 128m and half a CPU. The api peaks at about 80 MiB on `banki setup` and on every sign-in, hashing the Password, and is killed for running out of memory at 64m; `web` peaks at about 21 MiB.

An evicted, expired or taken-down Slug Preview doesn't come back by itself: dispatch it again. When a dispatch fails, to build or to deploy, the Slug's earlier Preview goes too, so nothing serves the Slug until it is dispatched again; the Slug stays its branch's until the failed dispatch's time to live runs out or it is taken down.

### How Previews run

A pull agent on the home server polls GitHub every 30 s and makes the running Previews match the open pull requests and the `slug-preview` deployments ([ADR-0008](docs/adr/0008-previews-pulled-by-an-agent-on-the-home-server.md), [ADR-0011](docs/adr/0011-slug-previews-dispatched-from-main-in-a-pool-of-their-own.md)). It plans the two pools apart and runs one deploy a loop; when both pools have one waiting, they take turns, so neither waits on the other forever. Nothing from GitHub runs on the server except inside a Preview's containers, and nothing on GitHub can reach the server. The agent keeps no state of its own: Docker says what runs, and the deployments say what was tried, so restarting it loses nothing. A deploy it was in the middle of is redone from scratch, unless the Preview already runs at that commit: then, as when GitHub refused to record a success, it only checks the Preview's health again and records the result, without taking it down.

| Path                                 | What it is                                                                                                                                                                                                                                                |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `deploy/preview/compose.yaml`        | The Preview template: one Preview as the Compose project `banki-pr-<N>` or `banki-slug-<slug>`, from the images pinned by digest, hardened and limited                                                                                                    |
| `deploy/preview/agent/`              | The agent (Bun, no npm dependencies) and its Dockerfile. `planner.ts` decides everything about PR Previews, `slug-planner.ts` about Slug Previews and `self-update.ts` when the agent updates itself; all are unit-tested, and the rest are thin adapters |
| `.github/workflows/slug-preview.yml` | Asks for a Slug Preview, takes one down, and sweeps their images                                                                                                                                                                                          |
| `deploy/preview/agent.compose.yaml`  | The agent, the Previews' Newt and the `banki-previews` network                                                                                                                                                                                            |
| `deploy/preview/bootstrap`           | Asks for the agent's settings and secrets and writes them outside the clone                                                                                                                                                                               |

Each deploy runs `docker compose down -v --remove-orphans --rmi all` on what was there, pulls the images, runs `banki setup` (the Password on stdin only) and `banki seed` against the empty volume, starts the Preview with `up --wait`, checks that `/api/health` through Caddy reports the pushed commit, and routes `pr-<N>.banki.dkomeza.com` or `<slug>.banki.dkomeza.com` to it through its own Pangolin resource. The agent only ever touches a resource at exactly such a host with a target on the Previews site, or one it created and was cut short before giving a target. When Pangolin says the host is taken by another resource, the deploy fails with `Pangolin: host taken`.

Before a deploy that would go over the cap, whenever a PR Preview goes idle and whenever a Slug Preview's time to live runs out, the agent first marks the deployment that made it `inactive` with the reason, then deletes its Pangolin resource and runs the same `down -v --remove-orphans --rmi all` as for a closed pull request. That mark is the only record: the agent still keeps no state, and if the teardown is cut off, the next loop sees the mark and finishes it.

Each Preview's own network is internal, so it has no internet access. Only its `web` also joins `banki-previews`, an internal network shared with the Newt of the Previews site (at `172.31.255.2`, the one proxy `web` trusts). So Previews can reach each other's `web`, but never each other's `api`, and the agent isn't on that network at all.

### Setting up the server

You need:

- A VPS running Pangolin (Community edition) with its Traefik, and a DNS record for `*.banki.dkomeza.com` pointing at it.
- In the Pangolin org, the domain `banki.dkomeza.com`, which the Previews' resources are made under.
- A Pangolin site for Previews only, of type Newt. Note its niceId, and the Newt ID and secret it gives you. The home server's own Newt keeps serving the homelab site and isn't touched: the Previews site gets its own Newt, in a container.
- Pangolin's Integration API turned on: `flags.enable_integration_api: true` in Pangolin's `config/config.yml`, and a Traefik route from a host of your choice (for example `api.pangolin.example.com`) to Pangolin's port 3003. Its URL, ending in `/v1`, is the Integration API URL `bootstrap` asks for.
- A Pangolin org API key with these actions: `listSites`, `getSite`, `listOrgDomains`, `listResources`, `getResource`, `createResource`, `updateResource`, `deleteResource`, `createTarget`, `listTargets`, `deleteTarget`.
- A fine-grained GitHub token for this repo only, with **Deployments: Read and write**, for the `preview`, `slug-preview`, `edge` and `production` deployments alike. It can always read the public repo, and the agent uses it for every GitHub call, since the anonymous limit of 60 calls an hour is less than a poll every 30 s needs.
- Both GHCR packages public (see [Preview images](#preview-images)): the agent and Docker read them anonymously.
- Docker with Compose v2 on the home server, with `172.31.255.0/24` unused.

Then, from a clone of `main` on the home server:

```sh
deploy/preview/bootstrap
docker compose -f deploy/preview/agent.compose.yaml up -d --build
```

`bootstrap` asks for the GitHub token, the Integration API URL, the org API key, the org ID, the Previews site's niceId, and Newt's `PANGOLIN_ENDPOINT`, ID and secret. The Preview's Email defaults to `preview@banki.dkomeza.com`. It generates the Password, 20 lowercase letters and digits in groups of 4 (`abcd-efgh-…`, about 100 bits and easy to type on a phone), and prints it once: keep it somewhere safe. Every Preview shares it, and each Preview runs its pull request's code, which can see it, so use it for Previews only and rotate it if it leaks.

It writes everything to `$BANKI_PREVIEW_SECRETS`, by default `~/.config/banki-preview`, outside the clone (a `0700` directory of `0600` files), and GitHub never holds any of it. The agent gets the GitHub token, the Pangolin key and the Preview's Email and Password as compose secrets, files under `/run/secrets/`, so they aren't in its environment in `docker inspect`; only Newt gets its ID and secret as environment variables.

Run `bootstrap` again to change a value: each one it has is the default, so Enter keeps it. It makes a new Password only when you answer yes to rotating it, and each Preview takes the new one from its next deploy. The agent reads the GitHub token and the Password afresh each time, but the Pangolin settings only on start, so after changing those run `docker compose -f deploy/preview/agent.compose.yaml up -d --force-recreate`.

The limits have defaults, and `bootstrap` doesn't ask for them. To change them, add any of these lines to `agent.env` in `$BANKI_PREVIEW_SECRETS` (`bootstrap` keeps them when it rewrites the file):

```sh
# How many PR Previews may run at once: a positive whole number.
PREVIEW_CAP=5
# How many days after its last deploy a PR Preview is removed. Decimals work: 0.01 is about 15 minutes.
PREVIEW_IDLE_DAYS=7
# How many Slug Previews may run at once: a positive whole number.
SLUG_PREVIEW_CAP=9
# Each Slug Preview's memory, in whole megabytes or gigabytes (128m, 1g; 6m at least), and CPUs (0.5, 2).
SLUG_PREVIEW_API_MEMORY=128m
SLUG_PREVIEW_API_CPUS=0.5
SLUG_PREVIEW_WEB_MEMORY=48m
SLUG_PREVIEW_WEB_CPUS=0.25
```

A PR Preview's own limits are fixed: api 256m and 1 CPU, web 128m and half a CPU. At 64m the api is killed for running out of memory on `banki setup` and on every sign-in, and `restart: unless-stopped` hides that from the health check, so lower `SLUG_PREVIEW_API_MEMORY` only after trying it.

The agent reads them only on start, so run `docker compose -f deploy/preview/agent.compose.yaml up -d --force-recreate` afterwards. A lower cap evicts nothing by itself: the next deploy evicts as many as it takes to fit within it. New memory and CPU limits apply to each Slug Preview from its next deploy.

The agent stops on start with a clear error when the Previews site or the `banki.dkomeza.com` domain can't be found, or a setting is missing or invalid. Its log says why:

```sh
docker compose -f deploy/preview/agent.compose.yaml logs agent
```

### The agent updates itself

The agent keeps its own clone of `main` in the `banki-preview-src` volume, fetched anonymously from `https://github.com/dkomeza/banki.git` ([ADR-0009](docs/adr/0009-the-pull-agent-updates-itself-through-a-helper-container.md)). Only `refs/heads/main` is ever fetched, checked out or built, so a pull request's branch never reaches the server, and the checkout you started it from is never touched.

At the start of every loop, before it plans anything, the agent fetches `main` and compares `deploy/preview/` between the commit it runs and `main`. When anything there changed, it starts `banki-preview-updater`, a one-shot helper container from its own image with the same hardening, which runs `docker compose -f deploy/preview/agent.compose.yaml up -d --build` on the clone. That rebuilds the agent and replaces it; Newt is only recreated when its own settings change. A change outside `deploy/preview/` rebuilds nothing.

The helper's output goes to the agent's log, and so does a failure: the old agent logs the helper's exit code and keeps running, and doesn't try that same `main` commit again until it restarts or `main` moves on. A failed fetch is logged and tried again on the next loop, and the Previews are kept in line either way:

```sh
docker compose -f deploy/preview/agent.compose.yaml logs agent | grep -i self-update
```

Running `docker compose -f deploy/preview/agent.compose.yaml up -d --build` by hand from a checkout still works, for the first start or to fix a broken agent. An agent started that way doesn't know its commit, so on its next loop it moves itself back onto `main`.

The agent only checks for updates once it has started, so one whose start-up crashes on a bug in `main` doesn't update itself, even after the fix is merged. Run `docker compose -f deploy/preview/agent.compose.yaml up -d --build` by hand from a checkout with the fix; once that agent runs, it moves itself back onto `main`.

The agent holds the Docker socket, so its image is only ever built on the server from `main`, never pulled from GHCR, where any pull request can push any tag. The Preview template is baked into that image, so a pull request can't change how its own Preview runs: a change to the template takes effect once it's merged and the agent has updated itself, and then for each Preview at its next push. Running Previews aren't redeployed.

### When a Preview fails

A Preview that fails is left stopped, its link gives a 404, and its deployment shows `failure` with a short reason. The agent doesn't retry it: the next push, or closing the pull request, clears it, and for a Slug Preview dispatching it again or its time to live running out. Logs never go to GitHub, and the reason is one of a few fixed texts (an unexpected error shows only `agent error, see the agent's log`); read the details on the server:

- The output of `setup` and `seed`, and of every other step, is in the agent's log, each line tagged with its project and step: `docker compose -f deploy/preview/agent.compose.yaml logs agent | grep banki-pr-<N>` (or `banki-slug-<slug>`).
- When `up` or the health check failed, the Preview's own containers have the story: `docker compose -p banki-pr-<N> logs` (or `-p banki-slug-<slug>`).
- A Slug Preview whose build failed shows `build failed`; the `slug-preview` workflow's run has the build's log.

### Sign-in cookies beside the Previews

Edge and Production share their parent domain with the Previews ([ADR-0017](docs/adr/0017-edge-follows-main-and-releases-promote-its-images-to-production.md)), and a Preview runs any pull request's code, so it can set cookies for `banki.dkomeza.com` and `dkomeza.com`. A `__Secure-` cookie set for the parent domain would reach Edge and Production too, so the sign-in cookie uses the `__Host-` prefix instead: a browser only accepts it from the exact host, over HTTPS, with `Path=/` and without a `Domain`, so a Preview can't plant or overwrite it. Every `https:` origin gets it, the Previews included.

The cookie was `__Secure-better-auth.session_token` before. The API ignores that name, so every device signs in once more, and the old cookie expires on its own within 30 days.

## Long-lived installations

Beside the Previews, two [Long-lived installations](CONTEXT.md) run on the home server ([ADR-0017](docs/adr/0017-edge-follows-main-and-releases-promote-its-images-to-production.md)): [Edge](CONTEXT.md) at `preview.banki.dkomeza.com`, which runs the newest commit of `main`, and [Production](CONTEXT.md) at `banki.dkomeza.com`, which runs the newest [Release](#releases) and holds the User's real data. Unlike a Preview, each keeps its data across deploys and migrates it in place.

They have a Pangolin site of their own, with its own Newt, on the `banki-long-lived` network (internal, `172.31.254.0/24`, Newt at `172.31.254.2`, and the rest handed out from `172.31.254.128/25`). Edge's and Production's `web` join it; the pull agent and every Preview never do, so no Preview can reach either of them.

| Path                                     | What it is                                                                                                                       |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `deploy/long-lived/compose.yaml`         | The Compose project `banki-long-lived`: their Newt and the `banki-long-lived` network                                            |
| `deploy/long-lived/bootstrap`            | Prints the Pangolin and DNS steps, and asks for Newt's settings and Edge's Email and Password                                    |
| `deploy/preview/long-lived.compose.yaml` | The Long-lived template: Edge or Production as the Compose project `banki-edge` or `banki-production`, which the pull agent runs |
| `deploy/preview/agent/long-lived-*.ts`   | The agent's third pool: `long-lived-planner.ts` decides, unit-tested; `snapshot.ts` takes, restores and prunes Snapshots         |

### Setting them up

You need the server set up for Previews first ([Setting up the server](#setting-up-the-server)), and `172.31.254.0/24` unused. Then, from a clone of `main` on the home server:

```sh
deploy/long-lived/bootstrap
docker compose -f deploy/long-lived/compose.yaml up -d
```

Run `bootstrap` before the agent takes the update that deploys Edge and Production: the agent gets `edge-email` and `edge-password` as compose secrets, and its self-update fails, keeping the old agent, while either file is missing. Once they are there, the next change under `deploy/preview/` updates it, or `docker compose -f deploy/preview/agent.compose.yaml up -d --build` does it now.

`bootstrap` first prints the steps to do by hand, waiting for Enter after each:

- In Pangolin's dashboard, a new site of type Newt for the Long-lived installations only: never the Previews' site, never the homelab one.
- Two HTTP resources under the `banki.dkomeza.com` domain, both on that site and with SSO off (Banki's own sign-in is the gate): `Banki Edge` at the subdomain `preview`, targeting `http`, `banki-edge-web-1`, port `8080`; and `Banki Production` at the base domain itself, targeting `http`, `banki-production-web-1`, port `8080`.
- On Cloudflare, a DNS record for `banki.dkomeza.com` itself pointing at the VPS, which `*.banki.dkomeza.com` doesn't cover, and a VPS certificate that covers it too.

Then it asks for Newt's `PANGOLIN_ENDPOINT` (the Previews' Newt's by default), ID and secret, and for Edge's Email and Password. Edge's Password is yours to pick, 8 to 128 characters, typed twice; it can't be the Previews' shared Password, which every Preview can read.

It writes `long-lived-newt.env`, `edge-email` and `edge-password` to `$BANKI_PREVIEW_SECRETS`, by default `~/.config/banki-preview`, beside the pull agent's files and never changing them (a `0700` directory of `0600` files, outside the clone). It writes no `AUTH_SECRET`: the api makes its own on its first start, in the data volume a Long-lived installation keeps across deploys. Newt gets its settings as environment variables; the agent's first Edge deploy sets Edge up from `edge-email` and `edge-password`. `bootstrap` itself starts nothing.

Run `bootstrap` again to change a value: each one it has is the default, so Enter keeps it, and it shows the Pangolin and DNS steps only when you ask. When Edge is running (`banki-edge-api-1`), a new Password is set in Edge first, with `banki reset-password --password-stdin`, and saved only once that worked, which signs out every Edge device; Edge's Email can't change, so reset Edge instead. Run it as a user who can use Docker: when Docker can't say whether Edge is running, it stops without saving anything. After changing Newt's settings, run `docker compose -f deploy/long-lived/compose.yaml up -d` again.

The two Pangolin resources are made by hand, and the agent has no business with them. Its org API key reaches the whole org, so its code is the guard: it only ever touches a resource at a Preview's host, and `preview` is a reserved Slug while the bare `banki.dkomeza.com` is no Slug at all.

### How the agent deploys them

The pull agent deploys both from a third pool of its own, beside the PR and Slug Preview pools ([ADR-0017](docs/adr/0017-edge-follows-main-and-releases-promote-its-images-to-production.md)): Edge from the `edge` deployments [main images](#main-images) creates, Production from the `production` deployments of [a Release](#releases). Each deployment's payload is `{ "sha", "api", "web" }`, the commit and its two images' digests; any other payload is marked `failure`, `invalid payload`. Only each installation's newest deployment is ever deployed, and older ones still waiting are marked `inactive`. A Long-lived deploy goes before any Preview's, still one deploy a loop, and has no cap: it never evicts a Preview, and no Preview evicts it.

Each installation is the Compose project `banki-edge` or `banki-production`, running the images by digest with the Preview's hardening and fixed limits, the same for both (api 512m and 1 CPU, web 128m and half a CPU), so Edge runs exactly what Production will. Unlike a Preview it reaches the internet, and only its `web` joins `banki-long-lived`. Its data lives in the volume `banki-edge-data` or `banki-production-data`, outside the project, so no `docker compose down` can remove it. The api generates its `AUTH_SECRET` and encryption key there on its first start, and they persist with the volume.

A deploy, which the deployment shows `in_progress`, `starting <sha>`:

1. **First boot**, when the volume doesn't exist: the agent creates it, labelled with the deployment. On Edge it then runs `banki setup` with `edge-email` and `edge-password` (the Password on stdin only) and `banki seed`. Production does neither: it starts empty, for your Setup (below).
2. **Any later deploy**: it pulls the new images, stops the running api and web (a few seconds of downtime), and takes a **Snapshot** of `banki.db` with `VACUUM INTO`, so the Snapshot holds every write the old version made.
3. It starts the new images with `up --wait`, so the api migrates the data in place, then checks that `/api/health` through `web` reports the deployment's commit.
4. On success, the deployment shows `success`, `deployed <sha>`, linking to `https://preview.banki.dkomeza.com` or `https://banki.dkomeza.com`. The installation's older Snapshots beyond the newest five, and its local images other than this deploy's and the previous one's, are removed.

The agent never brings back an installation someone stopped, and never retries a deployment that ended. A deploy cut short by a restart, though, is done again, with the Snapshot it took before its first try. The agent keeps no state: the images to roll back to are the newest `success` deployment's.

Snapshots live in the data volume itself, as `snapshots/<deployment ID>.db`; uploads and the key files stay in place. The agent takes, restores and prunes them in a one-off container of its own image, with only that volume mounted, no network, a read-only root, as the volume's owner (uid 1000), so they work whatever the app image is, the one that just failed included. They are not off-site backups.

### When a Long-lived deploy fails

The deployment shows `failure` with a short reason, and the agent's log has the details (`docker compose -f deploy/preview/agent.compose.yaml logs agent | grep banki-edge`, or `banki-production`; the installation's own with `docker compose -p banki-edge logs`):

- **`<reason>, rolled back to <sha>`**: the agent stopped the new images, restored the Snapshot over `banki.db` (removing its WAL files), and started the previous images, which passed the health check. The installation runs the previous version, with the data as it was before the deploy.
- **`<reason>, rollback failed, stopped`**: the restore, or the previous images, failed too, or there was no `success` deployment to roll back to. Both services are left stopped, so nothing writes to the data until you step in, and the Snapshot stays in the volume, as `snapshots/<deployment ID>.db`.
- **A failed first boot** shows just the reason: the agent removes the project and the volume it created, which held nothing else, so the next deployment starts afresh, Edge's setup included.

To redeploy Edge, after a fix on `main` or to try the same commit again, re-run the push's run of the `main-images` workflow: it makes a fresh `edge` deployment of the same images.

### Production's first Setup

Production's first deploy starts it empty, waiting for Setup. Take the Setup token from its logs, and open the link at `https://banki.dkomeza.com` to pick your Email and Password (see [First run](#first-run)):

```sh
docker logs banki-production-api-1 2>&1 | grep -i setup
```

## Releases

A [Release](CONTEXT.md) is a numbered version of Banki, `v0.1.0` and up, whose images are the very images [Edge](CONTEXT.md) ran ([ADR-0017](docs/adr/0017-edge-follows-main-and-releases-promote-its-images-to-production.md)). The `release` workflow (`.github/workflows/release.yml`) cuts it with [release-please](https://github.com/googleapis/release-please) and ships it to [Production](CONTEXT.md). There are no release branches: a hotfix merges to `main` and ships with the next Release.

| Path                            | What it is                                                                           |
| ------------------------------- | ------------------------------------------------------------------------------------ |
| `release-please-config.json`    | How release-please versions the repo and writes the notes                            |
| `.release-please-manifest.json` | The version of the newest Release, which release-please keeps                        |
| `CHANGELOG.md`                  | Every Release's notes, written by release-please (oxfmt leaves it alone)             |
| `.github/workflows/release.yml` | The Release PR on every push to `main`, and the promotion once the Release PR merges |

### Setting it up

Once, in the repo's **Settings**, **Actions**, **General**: turn on **Allow GitHub Actions to create and approve pull requests**. release-please opens the Release PR with `GITHUB_TOKEN`, and can't without it.

### The Release PR

Every push to `main` runs release-please, which keeps one Release PR open, titled `chore(main): release X.Y.Z`. It holds the next version, in the root, `apps/api`, `apps/web` and `packages/shared` `package.json`, in `bun.lock` and in `.release-please-manifest.json`, and the Release's notes, at the top of `CHANGELOG.md` and in its body. One version covers the whole repo, tagged `vX.Y.Z`.

- **The version** is SemVer from the squash-merged PR titles since the last Release: a `feat` bumps the minor version, a `fix` the patch. Before `1.0.0`, a breaking change bumps the minor version too, so `1.0.0` only ever comes from a deliberate `release-as`. The first Release is `0.1.0`, and its notes start at the walking skeleton (BAN-74), leaving out the prototype's commits.
- **The notes** are for the User and self-hosters: a **Features** and a **Fixes** section, and every other commit type left out. So is a commit that touches only `deploy/`, `.github/`, `.claude/`, `docs/` or `scripts/`. A stretch of only such commits opens no Release PR.
- **To edit the notes**, edit the Release PR just before you merge it: its body becomes the GitHub Release, and `CHANGELOG.md` on its branch the changelog. Each push to `main` rewrites the Release PR, edits included. release-please leaves out only whole directories, so an infrastructure `feat` or `fix` that also touched a root doc (`README.md`, `CONTEXT.md`, `AGENTS.md` or `CLAUDE.md`) still lands in the notes: rewrite its entry there as one generic line, such as "Improved release architecture".
- **`bun.lock`** records each workspace's version, so whenever release-please opens or updates the Release PR, the workflow runs `bun install --lockfile-only` on its branch and pushes the new `bun.lock` there, as `github-actions[bot]`. The PR after a Release then carries no lockfile diff.

The Release PR runs no workflows, since `GITHUB_TOKEN` can't trigger them, so its checks never appear. Merge it with the ruleset's admin bypass; CI runs on `main` right after.

**Merge nothing else to `main` until Edge has deployed the Release commit.** Edge deploys only its newest `edge` deployment, so a merge in between supersedes the Release's before Edge runs it, and the Release isn't shipped.

### The promotion

Merging the Release PR makes release-please tag `vX.Y.Z` and create the GitHub Release, and the `promote` job runs in the same run, since a tag pushed with `GITHUB_TOKEN` triggers nothing either. It runs only when release-please created a Release, one at a time across runs, and is never cancelled while it runs. GitHub keeps only the newest promotion waiting behind it, though: a third Release merged meanwhile cancels the one waiting, whose Release is then never promoted, and the newer Release carries it. A wait that GitHub doesn't answer asks again until it runs out, so an API error is never taken for Edge or Production failing.

1. **Wait for Edge.** It polls the `edge` deployments of the Release commit, which [main images](#main-images) creates once that commit's images exist. Edge has run the commit once any of them has a `success` status anywhere in its history. It fails on a `failure` or `error` status, on `inactive` without a `success` before it (a newer merge's deployment superseded it before the agent ran it), or after 60 minutes with neither.
2. **Tag `vX.Y.Z`.** It takes the `api` and `web` digests from that successful deployment's payload, checks that each is the Release commit's `sha-<sha>` manifest, and tags each image by digest as `vX.Y.Z`: both architectures, no rebuild. It reads the tag back, and never moves a `vX.Y.Z` that is already on other images.
3. **Deploy Production.** It creates a `production` deployment of the Release commit, `Production vX.Y.Z`, with those digests in its payload, `queued` (`waiting for the agent`), which the pull agent deploys ([How the agent deploys them](#how-the-agent-deploys-them)). It never creates one of a commit older than Production's newest deployment, so Production never goes back.
4. **Wait for Production.** `success` goes on; `failure`, `error` or `inactive`, or 60 minutes without a result, fails.
5. **Move `latest`.** It tags both images by digest as `latest`, and reads it back.

| Tag      | What it marks                                                                      |
| -------- | ---------------------------------------------------------------------------------- |
| `vX.Y.Z` | The images of Release `vX.Y.Z`, the ones Edge ran. It never moves                  |
| `latest` | The newest Release Production ran. It moves only once Production reports `success` |
| `v0.0.1` | A placeholder pushed by hand, not a Release. It stays                              |

Neither sweep touches `v…` or `latest`: the main-images sweep keeps every version with a tag other than `main` or `sha-…`, and PR cleanup any with a tag other than `pr-…` or `sha-…`.

### An unshipped Release

When Edge fails on the Release commit, or Production fails to deploy it, the Release is **not shipped**. The workflow puts a line at the top of the GitHub Release's notes, "**Not shipped:** Edge failed on this commit" or "Production failed to deploy it", "and the next Release carries the fix", and takes GitHub's **Latest** from it, back to the newest Release Production ran. `latest` doesn't move. The tag and the Release stay, and the run fails red.

Fix it on `main` as usual: the next Release carries the fix, and everything else since.

A promotion that failed on a transient error (GitHub or GHCR not answering, the agent down past the hour) is retried with **Re-run failed jobs** on the run: release-please already succeeded, so it creates no second Release. A re-run that ships the Release takes the "Not shipped" line off and makes it GitHub's Latest again. A re-run whose Production deployment already succeeded doesn't deploy Production again.

## Runner

The [Runner](CONTEXT.md) runs the `/work-issue` [Stages](CONTEXT.md) unattended, at night, on the home server ([ADR-0012](docs/adr/0012-stages-run-unattended-in-a-runner-container-on-the-home-server.md)). It sits beside the pull agent and shares nothing with it: no Docker socket, not on `banki-previews`, none of `~/.config/banki-preview`. Which Stage runs when is the [Dispatcher](CONTEXT.md)'s job ([ADR-0013](docs/adr/0013-linear-statuses-drive-the-stages-through-a-dispatcher-without-an-llm.md)): a plain program, no LLM, that goes by the issues' statuses, assignees and closing comments, waits on CI and the Previews without spending tokens, and starts Stages only inside a window and under a usage gate ([below](#the-dispatcher)).

It is one Compose project, `banki-runner`, with three containers from one image:

- **broker**, the [Broker](CONTEXT.md), holds the GitHub App's private key and the Linear app's client secret, and mints short-lived tokens from them. Nothing else runs there.
- **runner** runs the tick and the Stages. It holds only the Claude token, asks the Broker for GitHub and Linear tokens over a Unix socket, and never sees the keys.
- **dashboard** serves the [Dashboard](CONTEXT.md), a read-only web page of what the Runner is doing ([below](#the-dashboard); [ADR-0015](docs/adr/0015-the-dashboard-reads-through-the-broker-from-a-container-of-its-own.md)). It holds no secret, and reads the runner's volume read-only.

The broker and the runner share only the volume holding the Broker's socket, which the Dashboard mounts too. A Stage runs `claude` with permission prompts skipped and reads untrusted text, so it could be talked into sending whatever it can read: it can mint tokens through the socket, but it can't read the key that makes them, and every token it can get dies on its own. A GitHub token lasts an hour. A Linear token is minted when its Stage starts and revoked when it ends, or 4 hours after it was minted, whichever comes first.

A Stage still holds the Claude, GitHub and Linear tokens while it runs, and has open internet access: there is no egress allowlist (ADR-0012 records the trade-off). The host's firewall rules for the runner's network keep a Stage from the home server's ports and the home LAN ([below](#keeping-it-off-the-host-and-the-lan)), and the Previews' internal networks keep it from the Previews, but nothing keeps it from sending what it reads, so the Stages and the Dispatcher take input only from the Maintainer in Linear, and from `claude-review` on GitHub: its check, its summary comment by `github-actions[bot]` and its inline threads by `claude[bot]` (`.claude/skills/work-issue/references/stages.md` § Input).

| Path                          | What it is                                                                                                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `deploy/runner/compose.yaml`  | The three containers, hardened, with their networks, volumes and secrets                                                                                                 |
| `deploy/runner/Dockerfile`    | The image: pinned bun, node, git, gh and the `claude` CLI, and Chromium's system libraries                                                                               |
| `deploy/runner/broker/`       | The Broker (Bun, no npm dependencies): the App's JWT, the GitHub token cache and the Linear tokens' revoke schedule are pure and unit-tested; the rest are thin adapters |
| `deploy/runner/loop/`         | The tick loop: brings the clone onto `main`, runs `tick.ts`, and says when the image is behind `main`                                                                    |
| `deploy/runner/bin/`          | What is on PATH: `gh` and git's credential helper, which ask the Broker for a token on every call, `runner`, and `dashboard`                                             |
| `deploy/runner/tick.ts`       | The tick, run from the clone: it runs the Dispatcher                                                                                                                     |
| `deploy/runner/dispatch/`     | The Dispatcher and the Stages' supervisors. Which Stage is next, the window, the gate, the costs and the waits are pure and unit-tested; the rest are thin adapters      |
| `deploy/runner/cli/`          | `runner status`, `runner run-now` and `runner stage`, run from the clone                                                                                                 |
| `deploy/runner/dashboard/`    | The Dashboard, run from the clone: each page's view and HTML are pure and unit-tested; the server is a thin adapter                                                      |
| `deploy/runner/bootstrap`     | Asks for the Runner's secrets and writes them outside the clone                                                                                                          |
| `deploy/runner/host-firewall` | The host's firewall rules that keep the runner's and the Dashboard's networks off the home server and the LAN                                                            |

The Broker, the tick loop and the wrappers on PATH are baked into the image. The tick script, the Dispatcher, the CLI and the Dashboard run from the clone of `main` in the volume, so a merged change to them applies on the next tick (the Dashboard restarts on it).

### Linear: the statuses and the app

The Stages are driven by the issue's status (`docs/agents/issue-tracker.md` § Statuses, [ADR-0013](docs/adr/0013-linear-statuses-drive-the-stages-through-a-dispatcher-without-an-llm.md)). In the Banki team's settings, under **Workflow**, add:

- **In Design** and **Design Review**, in the Unstarted category, before Todo;
- **Acceptance**, in the Started category, after In Review.

The Runner is a Linear OAuth app acting as itself, so its comments and assignments come from it and notify you, and a comment from your account is always yours. Create it in **Settings → API → OAuth applications**:

1. Name it **Banki runner**. The callback URL is never used (the Runner doesn't sign in through a browser); give it any HTTPS URL, such as `https://banki.dkomeza.com`.
2. Turn on **Client credentials**. The Runner uses that grant only: Linear doesn't let an app mix grants and still hold several of its tokens at once. Its tokens act as the app (`actor=app`) with the `read` and `write` scopes the Broker asks for, and never `admin`.
3. Note the **client ID** and the **client secret**, for `bootstrap`.

A client-credentials token sees the workspace's public teams only. Keep the Banki team public, or give the app access to it on the app's details page.

A headless Stage reaches Linear through the `linear-banki` MCP server, authenticated as the Runner app (`docs/agents/issue-tracker.md`).

A token minted just after another of the app's was revoked is blind for under a second: it authenticates, but Linear answers `Entity not found` for every issue. The Runner's reads retry that for up to about 8 seconds, and `runner stage` reads the issue's branch with the Stage's own token before `claude` starts, so the Stage's MCP server never gets a blind one.

Linear names an issue's branch after whoever asks: `dkomeza/ban-11-…` for you, `bankirunner/ban-11-…` for the app. The issue's branch is the one on origin with that name under any prefix, so the Runner carries on a branch you started live, and you one it started; when origin has none, the Runner's first push creates `bankirunner/…`. When origin has it under several prefixes, the Dispatcher logs `Couldn't decide on BAN-N` on each tick and a Stage stops on you: delete the ones that aren't the issue's. The worktree is the name without its prefix, whoever started it.

### GitHub: the App

On GitHub the Runner is a private App installed on this repo only. In **Settings → Developer settings → GitHub Apps → New GitHub App**:

1. Name it **Banki runner** (its slug is then `banki-runner`). Any homepage URL will do. Turn **Webhook** off.
2. **Repository permissions.** Read and write: **Contents**, **Pull requests**, **Actions** (to dispatch `slug-preview`). Read-only: **Checks**, **Commit statuses**, **Deployments**, **Metadata**. Nothing else: in particular no **Workflows**, so no push can change `.github/workflows/`, where the Actions secrets are, and no **Administration**.
3. **Where can this GitHub App be installed?** Only on this account.
4. Create it, note its **App ID**, and **generate a private key**, which downloads a `.pem` file. `bootstrap` copies it in; delete the download afterwards.
5. **Install App**, on `dkomeza/banki` only (**Only select repositories**).

The Broker finds the installation itself. Every token it mints is for this repo alone, with the App's permissions, and lasts an hour; it mints a new one when under 15 minutes remain. Stages commit and push as `banki-runner[bot]`, with its noreply email, and `gh` and git ask the Broker for a token on every call, so a Stage outlives any one token.

`claude-review` runs for the App's pushes: `.github/workflows/claude-review.yml` names it in `allowed_bots`, and no other bot.

### GitHub: the merge guard

Whatever reaches `main` runs on the server on the next tick, the pull agent with its Docker socket included, so only you can make the App's pull requests mergeable. The `main` ruleset requires an approving review, dismisses approvals on a new push, and requires the last push to be approved by someone other than its pusher. The App isn't a bypass actor; your own (live-mode) pull requests merge through the existing admin bypass (`RepositoryRole` 5, in pull-request mode). Set it once with the command below. It reads the live ruleset, changes those three settings of its `pull_request` rule and nothing else, and writes it back, so a rule added since this was written is kept; it stops, writing nothing, when the ruleset has no `pull_request` rule. Then it reads the ruleset again:

```sh
ruleset=repos/dkomeza/banki/rulesets/25304272
body="$(gh api "$ruleset" | jq '
  if any(.rules[]; .type == "pull_request") then . else error("the ruleset has no pull_request rule") end
  | {name, target, enforcement, conditions, bypass_actors, rules: [.rules[]
      | if .type == "pull_request"
        then .parameters += {required_approving_review_count: 1, dismiss_stale_reviews_on_push: true, require_last_push_approval: true}
        else . end]}')" &&
  gh api --method PUT "$ruleset" --input - <<<"$body" >/dev/null &&
  gh api "$ruleset" --jq '{bypass_actors, rules: [.rules[].type], pull_request: (.rules[] | select(.type == "pull_request") | .parameters)}'
```

The read-back should show `required_approving_review_count: 1`, `dismiss_stale_reviews_on_push: true` and `require_last_push_approval: true`, the other rules as they were, and the one bypass actor, `RepositoryRole` 5.

### Setting it up

You need Docker with Compose v2 on the home server, and a Claude token made for the Runner alone, so it can be revoked without touching anything else:

```sh
claude setup-token
```

Then, from a checkout of `main` on the server:

```sh
deploy/runner/bootstrap
BANKI_RUNNER_COMMIT="$(git rev-parse HEAD)" docker compose -f deploy/runner/compose.yaml up -d --build
```

`bootstrap` asks for the Claude token, the App's ID and the path to its private key (which it copies in), and the Linear app's client ID and secret; the secrets are read without echo. It writes them to `$BANKI_RUNNER_SECRETS`, by default `~/.config/banki-runner`, outside the clone (a `0700` directory of `0600` files), and refuses a directory inside a git work tree. It also writes your uid and gid, the server's timezone, and that directory's path, to `deploy/runner/.env` (gitignored), which Compose reads: both containers run as you, so they can read your `0600` files with no extra capability, the Dispatcher's window runs on the server's clock (`TZ`, from `TZ`, `timedatectl`, `/etc/timezone` or `/etc/localtime`, in that order), and Compose refuses to start them until `bootstrap` has run. It keeps every other line in that file, so the Dispatcher's settings you put there ([below](#the-window)) survive a re-run. A Runner set up before the Dispatcher came needs `bootstrap` run once more, for the timezone. Run it again to change a value: each one it has is the default, so Enter keeps it. The Broker reads its settings only on start, so afterwards run `docker compose -f deploy/runner/compose.yaml up -d --force-recreate`.

The Broker gets the App's key and the Linear client secret, and the runner the Claude token, as compose secrets: files under `/run/secrets/`, so none is in an environment in `docker inspect`, and each container gets only its own. All three run with a read-only root filesystem, `no-new-privileges`, every capability dropped, and each on its own network with internet access; only the Dashboard publishes a port, on the host's `127.0.0.1` alone. The runner has an 8 GB memory cap, no CPU cap and a 1 GB `/dev/shm` for Chromium; the Broker has 128 MB, and the Dashboard 256 MB.

The runner's volume, `banki-runner-work`, is mounted at `/work`:

| Path                     | What it is                                                                                                                                                |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/work/banki`            | The clone of `main`, and each Stage's working directory                                                                                                   |
| `/work/banki-worktrees/` | The issues' worktrees, as on the laptop                                                                                                                   |
| `/work/logs/`            | Each Stage's logs, kept 30 days                                                                                                                           |
| `/work/dispatcher/`      | The Dispatcher's records: the gate's last reading, the Stages running or paused, the Stages that ended, for their costs, and the tick log (`ticks.jsonl`) |
| `/work/home/`            | HOME: `~/.claude`, bun's cache, and Playwright's browsers (`PLAYWRIGHT_BROWSERS_PATH`)                                                                    |

Chromium isn't in the image: each worktree installs the build its own Playwright wants with `npx playwright install chromium`, a no-op once it is there, so a Playwright bump on `main` needs no rebuild.

### Keeping it off the host and the LAN

A Stage runs branch code with permission prompts skipped, so the runner's network, `10.213.94.0/24` (fixed in `compose.yaml`), reaches the internet and nothing private; and so does the Dashboard's, `10.213.96.0/24`, since it runs from the clone a Stage can write to. Docker can't do that alone: the host's firewall does it, with `deploy/runner/host-firewall`, which drops everything from those subnets

- to the private ranges (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `100.64.0.0/10`, `169.254.0.0/16`), through Docker's `DOCKER-USER` chain: the home LAN, the other Docker networks and the Previews;
- to the host itself, at any of its addresses, through `INPUT`, which `DOCKER-USER` never sees: the home server's ports. Only the replies to connections the host itself started get through, such as `curl http://127.0.0.1:8790/` or Newt reaching the Dashboard; a container can't start one to the host.

Port 53 is let through both, for an upstream resolver on the LAN or on the host: Docker's embedded DNS (`127.0.0.11`) sits in the container's own namespace, but sends the queries it forwards from there too. The networks have no IPv6, so there are no `ip6tables` rules. If another network or your LAN already uses `10.213.94.0/24` or `10.213.96.0/24`, change it in both files (a test checks that they agree).

Install it as a systemd unit, which applies it whenever Docker starts, after a reboot included (iptables rules don't survive a reboot, and Docker keeps whatever is in `DOCKER-USER`):

```sh
sudo install -m 755 deploy/runner/host-firewall /usr/local/sbin/banki-runner-firewall
sudo tee /etc/systemd/system/banki-runner-firewall.service >/dev/null <<'UNIT'
[Unit]
Description=Keep the Banki Runner's network off the host and the LAN
After=docker.service
PartOf=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/local/sbin/banki-runner-firewall

[Install]
WantedBy=docker.service
UNIT
sudo systemctl daemon-reload
sudo systemctl enable --now banki-runner-firewall
```

`PartOf` applies the rules again whenever Docker restarts. After `host-firewall` changes on `main`, run the `install` line again, then `sudo systemctl restart banki-runner-firewall`; running it twice changes nothing. Check the rules with `sudo iptables -S BANKI-RUNNER-FORWARD` and `sudo iptables -S BANKI-RUNNER-INPUT`, and from inside, that the internet is in reach and the LAN isn't:

```sh
docker compose -f deploy/runner/compose.yaml exec runner curl -sS -m 5 https://api.github.com/zen
docker compose -f deploy/runner/compose.yaml exec runner curl -sS -m 5 http://192.168.1.1/ # times out
docker compose -f deploy/runner/compose.yaml exec dashboard curl -sS -m 5 https://api.github.com/zen
docker compose -f deploy/runner/compose.yaml exec dashboard curl -sS -m 5 http://192.168.1.1/ # times out
curl -sS -m 5 http://127.0.0.1:8790/ >/dev/null && echo "the Dashboard answers"
```

### The tick

Every 5 minutes the runner runs `git fetch origin main` and `git reset --hard origin/main` in `/work/banki`, in place, even while a Stage runs there, and then runs `deploy/runner/tick.ts` from the clone, which runs the [Dispatcher](#the-dispatcher). Each sync first makes sure the clone's `origin` is the repo, and removes the locks a git killed mid-write left in the clone's own git dir once they are 10 minutes old (never a worktree's). A failed sync skips the tick, so it never runs on a half-synced clone, and after three in a row the log says plainly that the clone is stuck. A failed tick is logged too, and the loop goes on:

```sh
docker compose -f deploy/runner/compose.yaml logs -f runner
```

The tick and `run-now` also append each line they print to `/work/dispatcher/ticks.jsonl` (`{ "at", "main", "line" }`), which the [Dashboard](#the-dashboard)'s `/ticks` shows; each tick drops its lines older than 30 days.

When anything baked into the image (`deploy/runner/Dockerfile`, `compose.yaml`, `broker/`, `loop/`, `lib/` or `bin/`) changed on `main` since the commit the image was built from, or `main` pins another bun (`packageManager` in `package.json`) or node (`.node-version`) than the image has, the log says so once per `main` commit, with the reason and the command to run by hand from an up-to-date checkout of `main`:

```sh
git pull
BANKI_RUNNER_COMMIT="$(git rev-parse HEAD)" docker compose -f deploy/runner/compose.yaml up -d --build
```

An image built without `BANKI_RUNNER_COMMIT` counts as behind, since nothing says what it holds.

### The Dispatcher

Each tick, the Dispatcher looks at the issues of project Banki and decides each one's next move from its status, its assignee, its closing comments and GitHub, with no LLM ([ADR-0013](docs/adr/0013-linear-statuses-drive-the-stages-through-a-dispatcher-without-an-llm.md); `docs/agents/issue-tracker.md` § Statuses):

| Status    | Next                                                                                                                                                                                                                                                                                                                                  |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Todo      | The implement Stage                                                                                                                                                                                                                                                                                                                   |
| In Design | The design Stage, unless a round is built since the issue came in from Backlog or Design Review: then the wait for its Variants' Slug Previews, and the hand-off to Design Review                                                                                                                                                     |
| In Review | The Acceptance fix, after a move back from Acceptance. Otherwise a review round, once `claude-review` has finished on the head SHA, with something to triage and no round on that SHA yet. Otherwise the wait for the PR Preview, and the hand-off to Acceptance, once `claude-review` passes and every thread it started is resolved |

It leaves alone any issue that is assigned, and any In Progress issue none of its supervisors started. The waits, the hand-offs and the stops cost no tokens, so they happen on every tick, in or out of the window; a wait that fails, or runs past its deadline (`.claude/skills/work-issue/references/stages.md` § Waits), is a stop on you. A state that fits none of the rows, such as a round that ran on this head SHA without the rounds ending, is a stop too, saying what it found.

Ready Stages start closest to Done first (In Review, then Todo, then In Design), then by Linear priority, then oldest. Each one runs under a **supervisor**, a detached `runner supervise`, which outlives the tick: it takes the gate's reading, looks at the issue again (and starts nothing if it was assigned or moved since the tick looked), sets it In Progress, runs the Stage as `runner stage` does for at most 3 hours of running time (SIGTERM to `claude` and everything it started, then SIGKILL a minute later), takes the reading again, and posts the Stage's closing comment and sets the next status from its result. At most `BANKI_RUNNER_MAX_STAGES` (2) run at once, paused ones included, and never two on one issue.

- **A crash or a timeout.** A supervisor that is gone while its issue is In Progress, or a Stage that ran out of time or left no result, puts back the status from before In Progress, posts a stop comment with the last 30 lines of its log (one per event, never the raw JSON), and assigns you.
- **The five-hour limit.** A Stage it cuts short is paused, not failed: its issue stays In Progress, unassigned, and the Stage goes on in its own `claude` session, its worktree as it left it, at the first tick in the window after that window starts over, ahead of the queue and still behind the gate. A paused Stage holds its place under the cap.

Each tick also deletes Stage logs older than 30 days, takes down a canceled issue's Variant Slug Previews, and removes the worktrees of Done or Canceled issues, Variants' included, once they are clean and every commit is on origin.

### The window

Stages start only inside the window, in server time:

| Variable                  | Default       | What it is                                                          |
| ------------------------- | ------------- | ------------------------------------------------------------------- |
| `BANKI_RUNNER_NIGHT`      | `01:00-07:00` | Every night, `HH:MM-HH:MM`; it may cross midnight                   |
| `BANKI_RUNNER_OPEN_DAYS`  | `sat,sun`     | Days open all day, and on into the night after them; empty for none |
| `BANKI_RUNNER_MAX_STAGES` | `2`           | How many Stages may run or wait paused at once                      |

An open day runs until the night after it ends, so with the defaults Saturday 00:00 to Monday 07:00 is one stretch. A Stage that is running finishes past the window. Set any of them, or the Ceiling's, in `deploy/runner/.env`, then `docker compose -f deploy/runner/compose.yaml up -d`.

### The Ceiling

Before it starts or resumes a Stage, the gate reads how much of each usage window is used, from the `rate_limit_event` of a one-line Haiku call with the Runner's Claude token. A Stage starts only if the week's utilization, plus the estimates of the Stages running, plus its own, stays within the [Ceiling](CONTEXT.md), and the five-hour window is under 80%. If the next Stage doesn't fit, a cheaper ready one may still start. A reading that fails starts nothing.

| Variable               | Default | What it is                                                 |
| ---------------------- | ------- | ---------------------------------------------------------- |
| `BANKI_RUNNER_CEILING` | `0.60`  | The share of the weekly window above which no Stage starts |

Your own use counts toward it, so whatever is above the Ceiling stays yours. A Stage's cost is how far the week moved between the readings before and after it, your use while it ran included; Stages that overlapped split their move by each one's dollar cost. A Stage with any run whose reading is missing has no known cost. Each kind of Stage is estimated at the median of its known costs, and at 5% until it has three.

### `runner status` and `runner run-now`

```sh
docker compose -f deploy/runner/compose.yaml exec runner runner status
docker compose -f deploy/runner/compose.yaml exec runner runner run-now BAN-N [--force]
```

`status` shows the Stages running and paused, the ready queue in order with why each one would or wouldn't start now, what the Dispatcher is waiting on, the gate's last reading and the estimates, the recent Stages with their costs, and the In Progress issues none of its supervisors started. It takes no reading and changes nothing.

`run-now` starts the issue's next Stage now, or resumes its paused one, even outside the window. It still keeps the cap, the five-hour check and the rule that skips an issue that is assigned or running; `--force` skips the Ceiling, and only that. It prints the Stage's log, or why nothing starts.

### The Dashboard

The [Dashboard](CONTEXT.md) shows what the Runner and the Dispatcher are doing, and what each issue went through, in one place, without ssh ([ADR-0015](docs/adr/0015-the-dashboard-reads-through-the-broker-from-a-container-of-its-own.md)). It is the `dashboard` service, at `runner.banki.dkomeza.com` behind Pangolin's SSO:

| Page                        | What it shows                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`, Now                    | What `runner status` shows, live, from the same view: the Stages running (for how long, their cost so far in dollars, their logs) and paused, the ready queue with why each would or wouldn't start, each wait with its deadline, how far along it is and its deployments' states, the gate's last reading against the Ceiling, and the In Progress issues no supervisor started |
| `/issues/BAN-N`             | The issue's timeline, oldest first: every attempt at a Stage (its outcome, a one-line reason, its cost and duration, its runs' logs), its closing comments (a Stage run live is marked live, a stop shows its question) and its moves in Linear. A run whose log has no `claude` init event **never started**, which is told apart from a crash                                  |
| `/issues/BAN-N/logs/<file>` | One Stage log, as the one-line summaries `runner stage` prints, never the raw JSON (its last 2000 lines at most, saying how many MB before them it leaves out), then the Stage's result. A running Stage's log streams as it grows. Only files under `/work/logs/BAN-N/` are served                                                                                              |
| `/ticks`                    | The tick log, newest first, with consecutive identical lines collapsed (`Tick on main abc1234 ×60`)                                                                                                                                                                                                                                                                              |

It also flags the pull agent's health, from GitHub alone: a `preview` or `slug-preview` deployment still `queued`, or with no status, 10 minutes after it was made says "the pull agent hasn't claimed it for N min", on the Now page and in the wait that waits on it.

The Now page's live view is computed when someone asks for it, at most once every 30 seconds whoever is watching, with one Linear token from the Broker, revoked after it; GitHub tokens come from the Broker as they do for the tick. Every page renders in full without JavaScript; with it, the Now page takes the live view every 30 seconds and a running Stage's log its new lines, over SSE.

It is **read-only**: it serves `GET` alone (anything else answers 405), makes no write to Linear or GitHub, mounts the volume read-only, and holds no secret, not even the Claude token, so there is no `run-now` and no usage reading there. Everything it shows from a log or a comment is escaped, and redacted of anything shaped like a GitHub, Linear or Claude token, under a CSP that allows no inline script or style and nothing from another origin.

It runs `deploy/runner/dashboard/` from the clone of `main` (through `dashboard` on PATH), and exits once the clone's `HEAD` moves, so Docker starts it again on the new `main`: a change to it needs no rebuild. It listens on `127.0.0.1:8790` on the host, and nowhere else:

```sh
docker compose -f deploy/runner/compose.yaml logs -f dashboard
curl -sS http://127.0.0.1:8790/ticks
```

Pangolin's SSO is its only auth: it trusts whatever reaches that port. Make its Pangolin resource by hand, once, in Pangolin's dashboard:

1. **Resources → Add Resource**: an HTTP resource named `Banki Runner`, on the **homelab** site (the Newt that runs as a host process on the home server), never the Previews' site: the target is the host's own `localhost`.
2. **Domain**: subdomain `runner` of `banki.dkomeza.com`. `runner` is a reserved Slug, so no Slug Preview can take it.
3. **Target**: `http`, `localhost`, port `8790`.
4. **Authentication**: turn on **Use Platform SSO**, and allow only your own user, not a role others hold.

Then open `https://runner.banki.dkomeza.com/`: Pangolin asks you to sign in first. To look at the pages without the home server, `bun deploy/runner/dashboard/fixture.ts` serves them on `127.0.0.1:8790` over a made-up Runner, with Linear and GitHub faked.

### When a Stage stops on you

A stop is a closing comment on the issue that asks you something, with the options it sees, the recommended one first, and the issue assigned to you. Answer it **in that comment's thread**: your reply hands the issue back, and on the next tick the Dispatcher unassigns it and runs that Stage again, which takes your reply as the answer. A stop from a wait that failed starts the wait over instead, counting its deadline from your reply. A top-level comment never hands an issue back. To take the issue yourself, run it live with `/work-issue BAN-N`, which keeps it assigned.

In Design Review and Acceptance a comment alone starts nothing: moving the issue back does, and the next Stage reads every comment of yours since the hand-off.

### Running one Stage by hand

```sh
docker compose -f deploy/runner/compose.yaml exec runner runner stage <design|implement|review-round|acceptance-fix> BAN-N
```

It runs the Stage's prompt (`.claude/skills/work-issue/stages/<kind>.md`) on the issue, headless, in the clone of `main`, as a Dispatcher-started one would. It gets a Linear token from the Broker for this Stage alone and gives `claude` a per-run MCP config (`0600`, deleted afterwards) whose one server is `linear-banki`, then runs `claude -p --output-format stream-json --verbose --dangerously-skip-permissions --strict-mcp-config --mcp-config <file> --add-dir /work/banki-worktrees` with the Claude token and no `ANTHROPIC_API_KEY`. It runs in the foreground and prints one line per event, prints the Stage's result (`<wt>/.ui/stage-result.json`) at the end, and revokes the Linear token whatever happens, Ctrl-C included. It never changes the issue's status or assignee, and posts no closing comment: that is the Dispatcher's job, so prefer `run-now`. `exec -d` instead of `exec` runs it detached.

### Reading a Stage's log

Every event of a Stage is kept in `/work/logs/BAN-N/<start time>-<kind>.jsonl`, one JSON object per line: `claude`'s stream-json events, and `runner` events for its start, its stderr, its time limit and its exit. A Stage the Dispatcher started has its supervisor's lines beside it, in `<start time>-<kind>.log`: one per event, as `runner stage` prints them, and what the supervisor did. A paused Stage has a pair for each run. Each tick deletes the logs older than 30 days.

```sh
docker compose -f deploy/runner/compose.yaml exec runner ls /work/logs/BAN-94
docker compose -f deploy/runner/compose.yaml exec runner tail -f /work/logs/BAN-94/2026-10-24T01-00-00Z-implement.log
docker compose -f deploy/runner/compose.yaml exec runner tail -f /work/logs/BAN-94/2026-10-24T01-00-00Z-implement.jsonl
docker compose -f deploy/runner/compose.yaml exec runner sh -c 'grep "\"type\":\"result\"" /work/logs/BAN-94/*.jsonl'
```

The Broker logs every token it mints or revokes, by ID, never the token itself:

```sh
docker compose -f deploy/runner/compose.yaml logs broker
```

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

| Script                 | What it does                                                                                                                                                                                                                                               |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run typecheck`    | `tsc -b` across every workspace                                                                                                                                                                                                                            |
| `bun run lint`         | oxlint, type-aware, warnings fail                                                                                                                                                                                                                          |
| `bun run format`       | oxfmt, rewriting files in place                                                                                                                                                                                                                            |
| `bun run format:check` | oxfmt, failing on unformatted files                                                                                                                                                                                                                        |
| `bun run test`         | Each workspace's tests: `bun test` (api, shared), Vitest (web), the `ui` script's under `node --test`, and the Preview agent's (`deploy/preview`), the Long-lived installations' (`deploy/long-lived`) and the Runner's (`deploy/runner`) under `bun test` |
