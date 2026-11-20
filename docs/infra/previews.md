# Previews

A [Preview](../../CONTEXT.md) is either a **PR Preview**, of an open pull request, or a **Slug Preview**, of any branch, asked for by its Slug ([below](#slug-previews)). The two are separate pools, each with its own limits, and neither ever evicts the other's Previews.

Every open pull request from a branch of this repo gets a PR Preview at `https://pr-<N>.banki.dkomeza.com`, drafts included. It is already set up, with the Preview's Email and Password and the [Seed data](../development.md#seed-data). Every push rebuilds it from scratch from the [images CI pushes](images.md#preview-images), with a fresh database, so you sign in again after a push. It's removed when the pull request closes or merges. Fork and Dependabot pull requests get none, the same rule CI uses for the images.

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

## Slug Previews

A Slug Preview is a Preview of any branch of this repo, without a pull request: for example one per variant of a prototype ([ADR-0011](../adr/0011-slug-previews-dispatched-from-main-in-a-pool-of-their-own.md)). It lives at `https://<slug>.banki.dkomeza.com`, is set up with the same Email and Password and Seed data as a PR Preview, and runs the same way. Dispatch the `slug-preview` workflow from `main` (the default; `--ref <branch>` would run the branch's own copy of the workflow):

```sh
gh workflow run slug-preview.yml -f branch=proto/blue -f slug=blue
gh workflow run slug-preview.yml -f branch=proto/blue -f slug=blue -f ttl_hours=168
```

The workflow resolves the branch to its head now and builds that commit's images. The Slug Preview doesn't follow later pushes: dispatch it again to redeploy it at the branch's new head, from scratch. It refuses, before it builds or creates anything:

- a Slug that isn't 2 to 40 lowercase letters, digits and single hyphens, starting with a letter and ending with a letter or digit; one starting with `pr-`; and the reserved `www`, `api`, `app`, `admin`, `auth`, `mail`, `status`, `preview`, `previews`, `edge`, `prod`, `production`, `staging`, `banki` and `runner`;
- a branch that doesn't exist, and `dependabot/*` branches;
- a `ttl_hours` that isn't a whole number from 1 to 336;
- a Slug another branch holds: `slug <slug> is held by branch <branch>`. A Slug is held by the branch of its newest deployment until that one is inactive. Take it down first to give it to another branch.

Dispatching needs write access to the repo, and nothing more. Dispatches of one Slug never run at the same time: GitHub keeps one waiting behind the running one, and a newer dispatch replaces the one waiting.

Take a Slug Preview down with `down`, which needs no branch:

```sh
gh workflow run slug-preview.yml -f slug=blue -f down=true
```

That marks the Slug's newest deployment that isn't inactive yet `inactive` (`taken down`), and then sweeps the [images](images.md#preview-images) of every Slug that is down. The agent tears the Preview down on its next loop, and the Slug is free again.

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

## How Previews run

A pull agent on the home server polls GitHub every 30 s and makes the running Previews match the open pull requests and the `slug-preview` deployments ([ADR-0008](../adr/0008-previews-pulled-by-an-agent-on-the-home-server.md), [ADR-0011](../adr/0011-slug-previews-dispatched-from-main-in-a-pool-of-their-own.md)). It plans the two pools apart and runs one deploy a loop; when both pools have one waiting, they take turns, so neither waits on the other forever. Nothing from GitHub runs on the server except inside a Preview's containers, and nothing on GitHub can reach the server. The agent keeps no state of its own: Docker says what runs, and the deployments say what was tried, so restarting it loses nothing. A deploy it was in the middle of is redone from scratch, unless the Preview already runs at that commit: then, as when GitHub refused to record a success, it only checks the Preview's health again and records the result, without taking it down.

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

## Setting up the server

You need:

- A VPS running Pangolin (Community edition) with its Traefik, and a DNS record for `*.banki.dkomeza.com` pointing at it.
- In the Pangolin org, the domain `banki.dkomeza.com`, which the Previews' resources are made under.
- A Pangolin site for Previews only, of type Newt. Note its niceId, and the Newt ID and secret it gives you. The home server's own Newt keeps serving the homelab site and isn't touched: the Previews site gets its own Newt, in a container.
- Pangolin's Integration API turned on: `flags.enable_integration_api: true` in Pangolin's `config/config.yml`, and a Traefik route from a host of your choice (for example `api.pangolin.example.com`) to Pangolin's port 3003. Its URL, ending in `/v1`, is the Integration API URL `bootstrap` asks for.
- A Pangolin org API key with these actions: `listSites`, `getSite`, `listOrgDomains`, `listResources`, `getResource`, `createResource`, `updateResource`, `deleteResource`, `createTarget`, `listTargets`, `deleteTarget`.
- A fine-grained GitHub token for this repo only, with **Deployments: Read and write**, for the `preview`, `slug-preview`, `edge` and `production` deployments alike. It can always read the public repo, and the agent uses it for every GitHub call, since the anonymous limit of 60 calls an hour is less than a poll every 30 s needs.
- Both GHCR packages public (see [Preview images](images.md#preview-images)): the agent and Docker read them anonymously.
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

## The agent updates itself

The agent keeps its own clone of `main` in the `banki-preview-src` volume, fetched anonymously from `https://github.com/dkomeza/banki.git` ([ADR-0009](../adr/0009-the-pull-agent-updates-itself-through-a-helper-container.md)). Only `refs/heads/main` is ever fetched, checked out or built, so a pull request's branch never reaches the server, and the checkout you started it from is never touched.

At the start of every loop, before it plans anything, the agent fetches `main` and compares `deploy/preview/` between the commit it runs and `main`. When anything there changed, it starts `banki-preview-updater`, a one-shot helper container from its own image with the same hardening, on Docker's default `bridge` network (Buildx fetches the registry tokens for the build from the helper itself), which runs `docker compose -f deploy/preview/agent.compose.yaml up -d --build` on the clone. That rebuilds the agent and replaces it; Newt is only recreated when its own settings change. A change outside `deploy/preview/` rebuilds nothing.

The helper's output goes to the agent's log, and so does a failure: the old agent logs the helper's exit code and keeps running, and doesn't try that same `main` commit again until it restarts or `main` moves on. A failed fetch is logged and tried again on the next loop, and the Previews are kept in line either way:

```sh
docker compose -f deploy/preview/agent.compose.yaml logs agent | grep -i self-update
```

Running `docker compose -f deploy/preview/agent.compose.yaml up -d --build` by hand from a checkout still works, for the first start or to fix a broken agent. An agent started that way doesn't know its commit, so on its next loop it moves itself back onto `main`.

The agent only checks for updates once it has started, so one whose start-up crashes on a bug in `main` doesn't update itself, even after the fix is merged. Run `docker compose -f deploy/preview/agent.compose.yaml up -d --build` by hand from a checkout with the fix; once that agent runs, it moves itself back onto `main`.

The agent holds the Docker socket, so its image is only ever built on the server from `main`, never pulled from GHCR, where any pull request can push any tag. The Preview template is baked into that image, so a pull request can't change how its own Preview runs: a change to the template takes effect once it's merged and the agent has updated itself, and then for each Preview at its next push. Running Previews aren't redeployed.

## When a Preview fails

A Preview that fails is left stopped, its link gives a 404, and its deployment shows `failure` with a short reason. The agent doesn't retry a failed deploy: the next push, or closing the pull request, clears it, and for a Slug Preview dispatching it again or its time to live running out. The one step it does try again is Pangolin's, after the Preview is up: the home server's uplink stalls now and then, so a Pangolin call that times out, loses its connection or gets a 5xx is tried again over about five minutes before the deploy fails with `Pangolin: couldn't create the resource`. Logs never go to GitHub, and the reason is one of a few fixed texts (an unexpected error shows only `agent error, see the agent's log`); read the details on the server:

- The output of `setup` and `seed`, and of every other step, is in the agent's log, each line tagged with its project and step: `docker compose -f deploy/preview/agent.compose.yaml logs agent | grep banki-pr-<N>` (or `banki-slug-<slug>`).
- When `up` or the health check failed, the Preview's own containers have the story: `docker compose -p banki-pr-<N> logs` (or `-p banki-slug-<slug>`).
- A Slug Preview whose build failed shows `build failed`; the `slug-preview` workflow's run has the build's log.

## Sign-in cookies beside the Previews

Edge and Production share their parent domain with the Previews ([ADR-0017](../adr/0017-edge-follows-main-and-releases-promote-its-images-to-production.md)), and a Preview runs any pull request's code, so it can set cookies for `banki.dkomeza.com` and `dkomeza.com`. A `__Secure-` cookie set for the parent domain would reach Edge and Production too, so the sign-in cookie uses the `__Host-` prefix instead: a browser only accepts it from the exact host, over HTTPS, with `Path=/` and without a `Domain`, so a Preview can't plant or overwrite it. Every `https:` origin gets it, the Previews included.

The cookie was `__Secure-better-auth.session_token` before. The API ignores that name, so every device signs in once more, and the old cookie expires on its own within 30 days.
