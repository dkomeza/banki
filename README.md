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

## Seeing the UI: the `ui` script

`bun run ui` starts a throwaway copy of Banki in this worktree and screenshots it, so you, and the `/work-issue` agents, can see the screens a change touches. The copy (the stack) is the API and Vite on free ports, already set up with a local throwaway User (`ui@example.com`), loaded with the [Seed data](#seed-data) and signed in. Its data directory is `.ui/data-<id>/`, never `apps/api/.data/`, so it leaves your own dev data alone, and stacks in several worktrees run side by side. Everything it writes is under `.ui/`, which is gitignored.

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
  "/stats": { mask: [".latency"] },
  "/setup": { mode: "before-setup" },
  "/decks/$deckId": { path: `/decks/${SEED_IDS.deck}` },
};
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

Drive it with [`playwright-cli`](https://github.com/microsoft/playwright-cli), from the worktree's root, so it reads `.playwright/cli.config.json`: headless, on Playwright's Chromium, with its output in `.ui/playwright-cli/`. Give each browser its own session with `-s=`:

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

Banki refuses to sign in from any address but `BANKI_ORIGIN` (the API's `ORIGIN`; `web` reads it too, for HSTS), which defaults to `http://localhost:8080`. Set it in `.env` to the exact address in your browser's address bar, without a path, whenever that isn't `http://localhost:8080`: when you open Banki by another host name or IP, on a different `BANKI_PORT`, or through an HTTPS reverse proxy:

```sh
BANKI_PORT=9000
BANKI_ORIGIN=http://192.168.1.20:9000
```

```sh
# Behind your own HTTPS proxy
BANKI_ORIGIN=https://banki.example.com
```

With an `https:` origin the sign-in cookie is `Secure` and `web` sends HSTS (see [Security headers](#security-headers)). A sign-in from the wrong address fails, and the API logs a warning naming both addresses.

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

| Tag            | What it marks                                                                                                                                                                                                                        |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pr-<N>`       | The newest push to PR `<N>`; it moves on every push                                                                                                                                                                                  |
| `sha-<sha>`    | The push of the PR's head commit `<sha>` (the full SHA)                                                                                                                                                                              |
| `pr-<N>-<sha>` | The same push. The pull agent waits for it and pulls by its digest, and cleanup finds every version PR `<N>` ever pushed by it. Only PR `<N>` pushes it, while two PRs on one commit share `sha-<sha>`, and one's cleanup deletes it |

When a PR closes, cleanup sweeps both packages and deletes every version of every PR that is no longer open: a version with a `pr-<M>` or `pr-<M>-…` tag whose PR `<M>` is closed, and with no tags but `pr-…` and `sha-…` ones. A version with any other tag, such as a release's `v1.0.0` or `latest`, is never touched. GHCR refuses to delete a package's last tagged version, so when a closed PR's version is the only one left, it stays until a later cleanup sweeps it after another PR has pushed, or for good once a release version lives in the same package. Pull requests from forks and Dependabot get no images.

Both packages start out private. Make each one public once, after its first push (on GitHub: the package's **Package settings**, then **Change visibility**), so the home server can pull them without credentials.

`GET /api/health` reports the commit its image was built from as `commit`: the full SHA in a preview image, and `"dev"` in local dev and in images built locally, such as with `docker compose`.

## Previews

Every open pull request from a branch of this repo gets a [Preview](CONTEXT.md) at `https://pr-<N>.banki.dkomeza.com`, drafts included. It is already set up, with the Preview's Email and Password and the [Seed data](#seed-data). Every push rebuilds it from scratch from the [images CI pushes](#preview-images), with a fresh database, so you sign in again after a push. It's removed when the pull request closes or merges. Fork and Dependabot pull requests get none, the same rule CI uses for the images.

The home server runs other things too, so Previews are limited:

- **At most 5 run at once.** When a deploy would make a sixth, the Preview whose last deploy is the oldest is evicted first (a tie goes to the lower pull request number). Only a Preview with a running container counts, or one that is restarting or paused, since it still holds its place: one that failed, one stopped by hand, or what's left after a failed start doesn't. The pull request being deployed is never evicted.
- **Each is removed 7 days after its last deploy**, whatever its state, unless a newer push is still waiting for its images: that one deploys when they arrive.

An evicted or idle Preview comes back on its next push, as the newest. Closing and reopening the pull request doesn't bring it back; pushing does.

Each Preview shows on its pull request as a deployment to the `preview` environment:

| Status        | What it means                                                                                                                                                      |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `queued`      | Waiting for the push's images. There's no timeout: a failed image build shows on the pull request, and the next push moves things on                               |
| `in_progress` | Deploying                                                                                                                                                          |
| `success`     | Up, with the Preview's link                                                                                                                                        |
| `failure`     | Didn't start, with a short reason such as `seed exited 1`, `api not healthy after 60 s` or `health reports wrong commit …`. See below                              |
| `inactive`    | The pull request closed (`PR closed`), a newer push replaced it, or it was removed by the limits: `evicted, push to rebuild` or `idle for 7 days, push to rebuild` |

While a new push waits for its images, the Preview of the previous push keeps running.

### How Previews run

A pull agent on the home server polls GitHub every 30 s and makes the running Previews match the open pull requests ([ADR-0008](docs/adr/0008-previews-pulled-by-an-agent-on-the-home-server.md)). Nothing from GitHub runs on the server except inside a Preview's containers, and nothing on GitHub can reach the server. The agent keeps no state of its own: Docker says what runs, and the deployments say what was tried, so restarting it loses nothing. A deploy it was in the middle of is redone from scratch, unless the Preview already runs at that commit: then, as when GitHub refused to record a success, it only checks the Preview's health again and records the result, without taking it down.

| Path                                | What it is                                                                                                                                                                                                       |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `deploy/preview/compose.yaml`       | The Preview template: one Preview as the Compose project `banki-pr-<N>`, from the images pinned by digest, hardened and limited                                                                                  |
| `deploy/preview/agent/`             | The agent (Bun, no npm dependencies) and its Dockerfile. `planner.ts` decides everything about Previews and `self-update.ts` when the agent updates itself; both are unit-tested, and the rest are thin adapters |
| `deploy/preview/agent.compose.yaml` | The agent, the Previews' Newt and the `banki-previews` network                                                                                                                                                   |
| `deploy/preview/bootstrap`          | Asks for the agent's settings and secrets and writes them outside the clone                                                                                                                                      |

Each deploy runs `docker compose down -v --remove-orphans --rmi all` on what was there, pulls the images, runs `banki setup` (the Password on stdin only) and `banki seed` against the empty volume, starts the Preview with `up --wait`, checks that `/api/health` through Caddy reports the pushed commit, and routes `pr-<N>.banki.dkomeza.com` to it through its own Pangolin resource.

Before a deploy that would go over the cap, and whenever a Preview goes idle, the agent first marks the deployment that made it `inactive` with the reason, then deletes its Pangolin resource and runs the same `down -v --remove-orphans --rmi all` as for a closed pull request. That mark is the only record: the agent still keeps no state, and if the teardown is cut off, the next loop sees the mark and finishes it.

Each Preview's own network is internal, so it has no internet access. Only its `web` also joins `banki-previews`, an internal network shared with the Newt of the Previews site (at `172.31.255.2`, the one proxy `web` trusts). So Previews can reach each other's `web`, but never each other's `api`, and the agent isn't on that network at all.

### Setting up the server

You need:

- A VPS running Pangolin (Community edition) with its Traefik, and a DNS record for `*.banki.dkomeza.com` pointing at it.
- In the Pangolin org, the domain `banki.dkomeza.com`, which the Previews' resources are made under.
- A Pangolin site for Previews only, of type Newt. Note its niceId, and the Newt ID and secret it gives you. The home server's own Newt keeps serving the homelab site and isn't touched: the Previews site gets its own Newt, in a container.
- Pangolin's Integration API turned on: `flags.enable_integration_api: true` in Pangolin's `config/config.yml`, and a Traefik route from a host of your choice (for example `api.pangolin.example.com`) to Pangolin's port 3003. Its URL, ending in `/v1`, is the Integration API URL `bootstrap` asks for.
- A Pangolin org API key with these actions: `listSites`, `getSite`, `listOrgDomains`, `listResources`, `getResource`, `createResource`, `updateResource`, `deleteResource`, `createTarget`, `listTargets`, `deleteTarget`.
- A fine-grained GitHub token for this repo only, with **Deployments: Read and write**. It can always read the public repo, and the agent uses it for every GitHub call, since the anonymous limit of 60 calls an hour is less than a poll every 30 s needs.
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

The limits have defaults, and `bootstrap` doesn't ask for them. To change them, add either line to `agent.env` in `$BANKI_PREVIEW_SECRETS` (`bootstrap` keeps them when it rewrites the file):

```sh
# How many Previews may run at once: a positive whole number.
PREVIEW_CAP=5
# How many days after its last deploy a Preview is removed. Decimals work: 0.01 is about 15 minutes.
PREVIEW_IDLE_DAYS=7
```

The agent reads them only on start, so run `docker compose -f deploy/preview/agent.compose.yaml up -d --force-recreate` afterwards. A lower cap evicts nothing by itself: the next deploy evicts as many as it takes to fit within it.

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

A Preview that fails is left stopped, its link gives a 404, and its deployment shows `failure` with a short reason. The agent doesn't retry it: the next push, or closing the pull request, clears it. Logs never go to GitHub, and the reason is one of a few fixed texts (an unexpected error shows only `agent error, see the agent's log`); read the details on the server:

- The output of `setup` and `seed`, and of every other step, is in the agent's log, each line tagged with its project and step: `docker compose -f deploy/preview/agent.compose.yaml logs agent | grep banki-pr-<N>`.
- When `up` or the health check failed, the Preview's own containers have the story: `docker compose -p banki-pr-<N> logs`.

### Cookies for a future production

A future production at `banki.dkomeza.com` would share its parent domain with the Previews, and a Preview runs any pull request's code, so it can set cookies for `banki.dkomeza.com` and `dkomeza.com`. Production's sign-in cookie must then use the `__Host-` prefix, which a browser only accepts from the exact host, over HTTPS and without a `Domain`, so a Preview can't plant or overwrite it.

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

| Script                 | What it does                                                                                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `bun run typecheck`    | `tsc -b` across every workspace                                                                                                                                    |
| `bun run lint`         | oxlint, type-aware, warnings fail                                                                                                                                  |
| `bun run format`       | oxfmt, rewriting files in place                                                                                                                                    |
| `bun run format:check` | oxfmt, failing on unformatted files                                                                                                                                |
| `bun run test`         | Each workspace's tests: `bun test` (api, shared), Vitest (web), the `ui` script's under `node --test`, and the Preview agent's (`deploy/preview`) under `bun test` |
