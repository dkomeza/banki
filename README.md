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

`dev` starts the API on <http://localhost:3000> (`bun --hot`) and the web app on <http://localhost:5173> (Vite), which proxies `/api` to the API. Open <http://localhost:5173>.

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
