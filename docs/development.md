# Development

Running Banki on your machine, its `banki` commands, and the checks CI runs. For the throwaway stacks and screenshots, see [the `ui` script](ui-script.md).

## Running it locally

You need [Bun](https://bun.sh) 1.4.3 (pinned in `package.json` under `packageManager`) and [Node.js](https://nodejs.org) 24 (pinned in `.node-version`), which runs Vite, Vitest and the [`ui` script](ui-script.md).

```sh
bun install
bun run dev
```

`dev` starts the API on <http://localhost:3000> (`bun --watch`, restarting on changes) and the web app on <http://localhost:5173> (Vite), which proxies `/api` to the API. Open <http://localhost:5173>.

The API restarts its whole process on a change rather than hot-reloading (`bun --hot`), because startup opens the database, applies migrations and installs signal handlers, and a hot reload would repeat that inside the old process.

In dev the API keeps its data in `apps/api/.data/` and logs in pretty text. Delete that folder to start over with an empty database. It is gitignored, as are all SQLite files.

## First run

Until Setup is done, Banki does nothing else. On every start while no User exists, the API logs a fresh Setup token at `warning`, with a link to Setup on `ORIGIN` such as `http://localhost:5173/setup?token=…`. Open that link and pick the Email and Password you'll sign in with. The token proves you can see the server's logs, so a stranger who reaches a fresh installation first can't claim it. A restart replaces it, and Setup discards it.

After Setup, everything except `/api/health`, `/api/setup` and signing in needs a signed-in browser. Signing in lasts 30 days, moving forward each day you use Banki, until you sign out.

## The `banki` commands

The API's `banki` script runs one-off commands against an installation's data directory. [Self-hosting](self-hosting.md) shows each one in Docker.

### Setting up from a shell

`banki setup` does Setup without the Setup page: headless Setup, for scripts, Previews and anyone with a shell on the server. Run it before the API starts, or while it waits for Setup (the Setup page then answers that Banki is already set up). In `apps/api`, against the dev data directory:

```sh
DATA_DIR=.data bun run banki setup
```

It asks for the Email, then for the Password twice with hidden input, asking again until both match and are valid. `--email you@example.com` skips the Email question. For scripts, `--email` with `--password-stdin` reads the Password from the first line of stdin instead, without asking:

```sh
printf '%s\n' "$PASSWORD" | DATA_DIR=.data bun run banki setup --email you@example.com --password-stdin
```

The Password never goes on the command line or in the environment. Setup from a shell needs no Setup token: a shell on the server proves at least as much. It refuses when Banki is already set up, and changes nothing. Like every `banki` command, it reads the same configuration as the API, applies any pending migrations, and creates the data directory if it is missing. For Docker, see [Setting up from a shell in Docker](self-hosting.md#setting-up-from-a-shell-in-docker).

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

It prints the User's Email, asks for the new Password twice, sets it and signs out every device. `--password-stdin` reads the Password from one line of stdin instead, without asking twice, for scripts. It reads the same configuration as the API (so set `DATA_DIR` the way the API has it) and works while the API runs. For Docker, see [Resetting the Password in Docker](self-hosting.md#resetting-the-password-in-docker).

## Checks

Run from the repo root; CI runs the same ones.

| Script                 | What it does                                                                                                                                                                                                                                               |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run typecheck`    | `tsc -b` across every workspace                                                                                                                                                                                                                            |
| `bun run lint`         | oxlint, type-aware, warnings fail                                                                                                                                                                                                                          |
| `bun run format`       | oxfmt, rewriting files in place                                                                                                                                                                                                                            |
| `bun run format:check` | oxfmt, failing on unformatted files                                                                                                                                                                                                                        |
| `bun run test`         | Each workspace's tests: `bun test` (api, shared), Vitest (web), the `ui` script's under `node --test`, and the Preview agent's (`deploy/preview`), the Long-lived installations' (`deploy/long-lived`) and the Runner's (`deploy/runner`) under `bun test` |

## Database migrations

The schema lives in `apps/api/src/db/schema.ts`, and the migrations drizzle-kit generates from it live in `apps/api/drizzle/` (SQL files plus `meta/`, all committed). To change the schema:

1. Edit `apps/api/src/db/schema.ts`.
2. Run `bun run db:generate` in `apps/api` and commit the new migration with the schema change.
3. Restart the API, which applies it.

CI runs `db:generate` too and fails if it would change any file, so a schema change without its migration can't be merged.

better-auth's tables (`user`, `auth_session`, `auth_account`, `auth_verification`) live in `apps/api/src/db/auth-schema.ts`, generated from the auth options in `apps/api/src/auth/auth.ts`. After changing those options, or upgrading better-auth, run `bun run auth:generate` in `apps/api`, then `bun run db:generate` for the migration.

## The Grader's eval

The Grader (`apps/api/src/grader/`) is checked against the real OpenRouter by an eval, never by a test: every test stubs OpenRouter. `apps/api/src/grader/eval/samples.ts` holds about ten Cards with a Written answer each and the Rating it should get (an equivalent form, a lost minus sign in a derivation, a Polish answer, a Card with an Image, a Grading note's "must", a blank-ish answer, a flawless one, and a few more). The eval grades every sample with every curated Model and prints a table of each Model's Rating beside the expected one, marking with ⚠ a Rating two or more steps off.

Run it from the repo root with an OpenRouter key of your own; it spends a little of its credit:

```sh
OPENROUTER_API_KEY=sk-or-v1-… bun run --cwd apps/api grader:eval
```

It grades through the Grader's own `grade()`, so it retries OpenRouter's temporary errors as the app does. It fails (exit code 1) when the default Model is two or more steps off on any sample, or fails one with a permanent error (`failed: api_key_refused`, `no_credits`, `model_unavailable` or `grading_refused` in its cell); the other Models' results are for reading only. A sample a Model still failed to grade after its retries shows as `failed` without failing it (when the default Model fails some, a warning under the table says how many). With no `OPENROUTER_API_KEY` it skips with a note.

The `Grader eval` workflow runs it on pull requests that change `apps/api/src/grader/**` or the Model list (`packages/shared/src/models.ts`), weekly on Mondays, and by hand (Actions → Grader eval → Run workflow), with the table in the job summary. It reads the key from the `OPENROUTER_API_KEY` repository secret, which the Maintainer adds (Settings → Secrets and variables → Actions); without it (before it is added, on Dependabot's pull requests and on forks) the job skips with a note and passes.

## Checking the Docker images

Two scripts check the images [Self-hosting](self-hosting.md) runs. Both run on demand only, not in CI.

`bun run smoke:docker` builds both images for this machine under throwaway tags, leaving any `banki-api` and `banki-web` you run untouched, and starts the stack under a throwaway project on a free port. Through the web port only, it checks:

- the app, a deep link, health, the API's 401 and 404, and asset caching;
- the security headers: the full CSP everywhere, no HSTS under the default http origin, and HSTS from the web image started again alone with an `https://` `BANKI_ORIGIN`;
- the manifest's type and its PNG icons, and that there is no service worker at `/sw.js`;
- Setup with the logged token, signing in and out, and the client IP Caddy forwards, with and without `BANKI_TRUSTED_PROXIES`;
- non-root users, a restart, `reset-password --password-stdin`, that a second `banki setup` through `docker compose run --rm -T api` is refused and signing in still works, that `banki seed` succeeds the same way, and a clean stop.

Then it removes the stack, its volume and its images, also when a check fails or it gets SIGINT or SIGTERM.

`bun run docker:buildx` builds both images for `linux/amd64` and `linux/arm64` without loading them. It needs a buildx builder that can build for several platforms; if yours can't, create one with `docker buildx create --use`.
