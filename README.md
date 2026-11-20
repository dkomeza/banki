# Banki

A spaced-repetition app built around writing answers and having an LLM grade them.

## Quick start

You need [Bun](https://bun.sh) 1.4.3 and [Node.js](https://nodejs.org) 24.

```sh
bun install
bun run dev
```

Open <http://localhost:5173> and follow the Setup link the API logs on its first start ([First run](docs/development.md#first-run)).

To self-host it instead, `docker compose up -d` and open <http://localhost:8080> ([Self-hosting](docs/self-hosting.md)).

## Docs

| Page                                 | What it covers                                                                                 |
| ------------------------------------ | ---------------------------------------------------------------------------------------------- |
| [Development](docs/development.md)   | Running it locally, Setup, the `banki` commands, the checks, migrations and the Grader's eval  |
| [The `ui` script](docs/ui-script.md) | Throwaway stacks and screenshots of the web app, and the before/after shots for a pull request |
| [Self-hosting](docs/self-hosting.md) | Docker Compose, the address and HTTPS, the data directory and backups, the API's configuration |
| [Design](docs/design.md)             | The design language and the conventions screens follow                                         |
| [CONTEXT.md](CONTEXT.md)             | The domain's words and what each one means                                                     |
| [Decisions](docs/adr/)               | The architecture decision records                                                              |

The home server's infrastructure, for the Maintainer:

| Page                                                 | What it covers                                                                   |
| ---------------------------------------------------- | -------------------------------------------------------------------------------- |
| [Container images](docs/infra/images.md)             | The images CI pushes to GHCR, their tags and their sweeps                        |
| [Previews](docs/infra/previews.md)                   | PR and Slug Previews, and the pull agent that runs them                          |
| [Long-lived installations](docs/infra/long-lived.md) | Edge and Production: deploys, Snapshots, rollbacks and resetting Edge            |
| [Releases](docs/infra/releases.md)                   | The Release PR, and promoting Edge's images to Production                        |
| [Runner](docs/infra/runner.md)                       | The `/work-issue` Stages run unattended: setup, the Dispatcher and the Dashboard |

## Layout

| Workspace       | Path              | What it is                                                      |
| --------------- | ----------------- | --------------------------------------------------------------- |
| `@banki/api`    | `apps/api`        | Hono API on Bun, every route under `/api`                       |
| `@banki/web`    | `apps/web`        | React SPA: Vite, TanStack Router and Query, Tailwind, shadcn/ui |
| `@banki/shared` | `packages/shared` | Runtime-agnostic contracts (zod schemas) shared by both apps    |

The home server's deployments live under `deploy/`: `preview/` (the pull agent and the Previews), `long-lived/` (Edge and Production) and `runner/`.
