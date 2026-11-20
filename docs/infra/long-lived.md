# Long-lived installations

Beside the Previews, two [Long-lived installations](../../CONTEXT.md) run on the home server ([ADR-0017](../adr/0017-edge-follows-main-and-releases-promote-its-images-to-production.md)): [Edge](../../CONTEXT.md) at `edge.banki.dkomeza.com`, which runs the newest commit of `main`, and [Production](../../CONTEXT.md) at `banki.dkomeza.com`, which runs the newest [Release](releases.md) and holds the User's real data. Unlike a Preview, each keeps its data across deploys and migrates it in place.

They have a Pangolin site of their own, with its own Newt, on the `banki-long-lived` network (internal, `172.31.254.0/24`, Newt at `172.31.254.2`, and the rest handed out from `172.31.254.128/25`). Edge's and Production's `web` join it; the pull agent and every Preview never do, so no Preview can reach either of them.

| Path                                     | What it is                                                                                                                                       |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `deploy/long-lived/compose.yaml`         | The Compose project `banki-long-lived`: their Newt and the `banki-long-lived` network                                                            |
| `deploy/long-lived/bootstrap`            | Prints the Pangolin and DNS steps, and asks for Newt's settings and Edge's Email and Password                                                    |
| `deploy/preview/long-lived.compose.yaml` | The Long-lived template: Edge or Production as the Compose project `banki-edge` or `banki-production`, which the pull agent runs                 |
| `deploy/preview/agent/long-lived-*.ts`   | The agent's third pool: `long-lived-planner.ts` decides, unit-tested; `snapshot.ts` takes, restores and prunes Snapshots, and clears for a Reset |
| `.github/workflows/reset-edge.yml`       | Resets Edge to Seed data ([Resetting Edge](#resetting-edge))                                                                                     |

## Setting them up

You need the server set up for Previews first ([Setting up the server](previews.md#setting-up-the-server)), and `172.31.254.0/24` unused. Then, from a clone of `main` on the home server:

```sh
deploy/long-lived/bootstrap
docker compose -f deploy/long-lived/compose.yaml up -d
```

Run `bootstrap` before the agent takes the update that deploys Edge and Production: the agent gets `edge-email` and `edge-password` as compose secrets, and its self-update fails, keeping the old agent, while either file is missing. Once they are there, the next change under `deploy/preview/` updates it, or `docker compose -f deploy/preview/agent.compose.yaml up -d --build` does it now.

`bootstrap` first prints the steps to do by hand, waiting for Enter after each:

- In Pangolin's dashboard, a new site of type Newt for the Long-lived installations only: never the Previews' site, never the homelab one.
- Two HTTP resources under the `banki.dkomeza.com` domain, both on that site and with SSO off (Banki's own sign-in is the gate): `Banki Edge` at the subdomain `edge`, targeting `http`, `banki-edge-web-1`, port `8080`; and `Banki Production` at the base domain itself, targeting `http`, `banki-production-web-1`, port `8080`.
- On Cloudflare, a DNS record for `banki.dkomeza.com` itself pointing at the VPS, which `*.banki.dkomeza.com` doesn't cover, and a VPS certificate that covers it too.

Then it asks for Newt's `PANGOLIN_ENDPOINT` (the Previews' Newt's by default), ID and secret, and for Edge's Email and Password. Edge's Password is yours to pick, 8 to 128 characters, typed twice; it can't be the Previews' shared Password, which every Preview can read.

It writes `long-lived-newt.env`, `edge-email` and `edge-password` to `$BANKI_PREVIEW_SECRETS`, by default `~/.config/banki-preview`, beside the pull agent's files and never changing them (a `0700` directory of `0600` files, outside the clone). It writes no `AUTH_SECRET`: the api makes its own on its first start, in the data volume a Long-lived installation keeps across deploys. Newt gets its settings as environment variables; the agent's first Edge deploy, and each Reset, sets Edge up from `edge-email` and `edge-password`. `bootstrap` itself starts nothing.

Run `bootstrap` again to change a value: each one it has is the default, so Enter keeps it, and it shows the Pangolin and DNS steps only when you ask. When Edge is running (`banki-edge-api-1`), a new Password is set in Edge first, with `banki reset-password --password-stdin`, and saved only once that worked, which signs out every Edge device. A new Email is saved too, but a running Edge keeps its current one until it's reset: `bootstrap` says so and prints the command ([Resetting Edge](#resetting-edge)). Run it as a user who can use Docker: when Docker can't say whether Edge is running, it stops without saving anything. After changing Newt's settings, run `docker compose -f deploy/long-lived/compose.yaml up -d` again.

The two Pangolin resources are made by hand, and the agent has no business with them. Its org API key reaches the whole org, so its code is the guard: it only ever touches a resource at a Preview's host, and `edge` is a reserved Slug while the bare `banki.dkomeza.com` is no Slug at all.

## How the agent deploys them

The pull agent deploys both from a third pool of its own, beside the PR and Slug Preview pools ([ADR-0017](../adr/0017-edge-follows-main-and-releases-promote-its-images-to-production.md)): Edge from the `edge` deployments [main images](images.md#main-images) creates, Production from the `production` deployments of [a Release](releases.md). Each deployment's payload is `{ "sha", "api", "web" }`, the commit and its two images' digests; any other payload is marked `failure`, `invalid payload`. Only each installation's newest deployment is ever deployed, and older ones still waiting are marked `inactive`. A Long-lived deploy goes before any Preview's, still one deploy a loop, and has no cap: it never evicts a Preview, and no Preview evicts it.

Each installation is the Compose project `banki-edge` or `banki-production`, running the images by digest with the Preview's hardening and fixed limits, the same for both (api 512m and 1 CPU, web 128m and half a CPU), so Edge runs exactly what Production will. Unlike a Preview it reaches the internet, and only its `web` joins `banki-long-lived`. Its data lives in the volume `banki-edge-data` or `banki-production-data`, outside the project, so no `docker compose down` can remove it. The api generates its `AUTH_SECRET` and encryption key there on its first start, and they persist with the volume.

Production's api runs with `RELEASE=true`, and Edge's never does. The images are the same, so this is what tells a Release apart: `/api/health` reports `release: true`, and Settings shows the version as `0.3.0`, linking to its Release notes, where Edge shows `0.3.0+<short commit>`, linking to the commit. An api without a commit baked in (`bun run dev`, the `ui` stacks, a self-built `docker compose up`) shows `0.3.0+dev`, unless it is given `RELEASE=true` too.

A deploy, which the deployment shows `in_progress`, `starting <sha>`:

1. **First boot**, when the volume doesn't exist: the agent creates it, labelled with the deployment. On Edge it then runs `banki setup` with `edge-email` and `edge-password` (the Password on stdin only) and `banki seed`. Production does neither: it starts empty, for your Setup (below).
2. **Any later deploy**: it pulls the new images, stops the running api and web (a few seconds of downtime), and takes a **Snapshot** of `banki.db` with `VACUUM INTO`, so the Snapshot holds every write the old version made.
3. It starts the new images with `up --wait`, so the api migrates the data in place, then checks that `/api/health` through `web` reports the deployment's commit.
4. On success, the deployment shows `success`, `deployed <sha>`, linking to `https://edge.banki.dkomeza.com` or `https://banki.dkomeza.com`. The installation's older Snapshots beyond the newest five, and its local images other than this deploy's and the previous one's, are removed.

The agent never brings back an installation someone stopped, and never retries a deployment that ended. A deploy cut short by a restart, though, is done again, with the Snapshot it took before its first try. The agent keeps no state: the images to roll back to are the newest `success` deployment's.

Snapshots live in the data volume itself, as `snapshots/<deployment ID>.db`; uploads and the key files stay in place. The agent takes, restores and prunes them in a one-off container of its own image, with only that volume mounted, no network, a read-only root, as the volume's owner (uid 1000), so they work whatever the app image is, the one that just failed included. They are not off-site backups.

## When a Long-lived deploy fails

The deployment shows `failure` with a short reason, and the agent's log has the details (`docker compose -f deploy/preview/agent.compose.yaml logs agent | grep banki-edge`, or `banki-production`; the installation's own with `docker compose -p banki-edge logs`):

- **`<reason>, rolled back to <sha>`**: the agent stopped the new images, restored the Snapshot over `banki.db` (removing its WAL files), and started the previous images, which passed the health check. The installation runs the previous version, with the data as it was before the deploy.
- **`<reason>, rollback failed, stopped`**: the restore, or the previous images, failed too, or there was no `success` deployment to roll back to. Both services are left stopped, so nothing writes to the data until you step in, and the Snapshot stays in the volume, as `snapshots/<deployment ID>.db`.
- **A failed first boot** shows just the reason: the agent removes the project and the volume it created, which held nothing else, so the next deployment starts afresh, Edge's setup included.

To redeploy Edge, after a fix on `main` or to try the same commit again, re-run the push's run of the `main-images` workflow: it makes a fresh `edge` deployment of the same images.

## Resetting Edge

Edge keeps its data across deploys, so when it has drifted too far from [Seed data](../development.md#seed-data), **reset** it, without ssh:

```sh
gh workflow run reset-edge.yml
```

The `reset-edge` workflow, dispatched from `main`, copies Edge's newest `edge` deployment, whatever its status: a new `edge` deployment of the same commit and images, with `"reset": true` in its payload, `Edge reset <sha>`. So a Reset runs the commit Edge was last asked to run, its images are always built already, and Edge never goes backwards. It fails, creating nothing, when Edge has no deployment yet, or the newest one's payload isn't a valid `{ "sha", "api", "web" }`.

The agent deploys it like any upgrade (`in_progress`, `resetting to <sha>`): it pulls, stops api and web, and takes the Snapshot, `snapshots/<deployment ID>.db`, which holds what Edge had before the Reset. Then it clears the database (`banki.db` and its WAL files, in the Snapshot's one-off container), runs `banki setup` with `edge-email` and `edge-password` and `banki seed` on the new images, and starts them. On success the deployment shows `success`, `reset to <sha>`.

- **What's cleared**: the database alone, so every Edge device is signed out. Uploads, the `AUTH_SECRET` and encryption key files, and `snapshots/` stay; the app's own sweep deletes uploads no Card refers to after 24 hours.
- **A newer push** that overtakes a Reset still waiting carries it on: the newest deployment is deployed as a Reset, and the older one is marked `inactive` as usual. A Reset cut short by a restart, once it cleared the database, is finished by whichever deploy comes next, its retry or a newer push's: a mark in the volume (`snapshots/reset`) says so, and every one of them keeps the Snapshot from before the Reset to roll back to.
- **A failed Reset** is rolled back like any failed deploy ([When a Long-lived deploy fails](#when-a-long-lived-deploy-fails)): the Snapshot goes back over `banki.db` and the previous images start, so Edge holds exactly what it held before.
- **With no data volume** yet, a Reset is just a first boot, which sets up and seeds anyway.

To change Edge's Email, rerun `deploy/long-lived/bootstrap` with the new one, then reset Edge: Banki has no command to change an Email, so Edge takes it only when it's set up again. Production is never reset.

## Production's first Setup

Production's first deploy starts it empty, waiting for Setup. Take the Setup token from its logs, and open the link at `https://banki.dkomeza.com` to pick your Email and Password (see [First run](../development.md#first-run)):

```sh
docker logs banki-production-api-1 2>&1 | grep -i setup
```
