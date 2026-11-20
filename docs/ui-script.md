# The `ui` script

`bun run ui` starts a throwaway copy of Banki in this worktree and screenshots it, so you, and the `/work-issue` agents, can see the screens a change touches. The copy (the stack) is the API and Vite on free ports, already set up with a local throwaway User (Email `asdf@asdf.asdf`, Password `asdfasdf`, so you can sign in to it by hand), loaded with the [Seed data](development.md#seed-data) and signed in. Its data directory is `.ui/data-<id>/`, never `apps/api/.data/`, so it leaves your own dev data alone, and stacks in several worktrees run side by side. Everything it writes is under `.ui/`, which is gitignored.

It runs on Node (Playwright doesn't support Bun) and drives Playwright's own Chromium, which you install once:

```sh
npx playwright install chromium
```

Without it, the script stops and prints that command.

## `ui shoot`

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

## The route manifest

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
- `path`: the one concrete path to shoot a route with params at, built from the [Seed data](development.md#seed-data)'s fixed IDs (`SEED_IDS`, in `apps/api/src/seed/seed-ids.ts`). Every route with params needs one.
- `mask`: CSS selectors of content that differs on every run, such as a measured latency or random content. Every shot of the route, in `ui shoot` and on both sides of `ui compare`, hides them (`visibility: hidden`, through Playwright's screenshot `style`): they keep their place on the page but draw nothing, so they never count as a change, whatever their size.

An issue that adds a routed screen with params or a sign-in mode adds its entry, with any fixed ID it needs in `SEED_IDS`, and a screen with content that differs on every run masks it.

## `ui compare`

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

## `ui up` and `ui down`

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
