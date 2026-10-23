# Stages run unattended in a Runner container on the home server

The `/work-issue` Stages (building Variants, implementing, review rounds, Acceptance fixes) run unattended in a Runner: a container on the home server beside the pull agent, but sharing nothing with it. It has no Docker socket, isn't on `banki-previews` and can't read the pull agent's secrets. Its own volume holds a clone of `main` and the worktrees, and it has a memory cap. Stages run `claude -p` with permission prompts skipped, so the container is the boundary. This amends ADR-0008: the server now runs branch code (tests, the `ui` stack, Playwright) outside a Preview, in the Runner.

## Considered Options

- **GitHub Actions** (`claude-code-action` on a schedule): rejected. The repo is public, and every branch's workflow, including the ones the agents write, could read the Claude token and the Linear key (the reason ADR-0008 keeps secrets out of GitHub).
- **Inside the pull agent's container**: rejected. It holds the Docker socket, and the Stages run code from branches.
- **The laptop**: rejected. It isn't on at night, which is when the Stages run. The laptop still runs Stages live through `/work-issue`.
- **A permission allowlist** instead of skipping prompts: rejected. In `-p` mode a gap in the list makes a Stage fail in the middle of the night, and the container already limits what a Stage can reach.

## Consequences

- On each tick the Runner fetches `main` into its clone and runs the Dispatcher and the Stage prompts from it, so a merged change applies on the next tick without a Docker socket (unlike the pull agent, ADR-0009). Only a change to the image needs `docker compose … up -d --build` by hand.
- Stages hand over through origin and Linear only: the issue's description is the spec, and the pushed branches and the pull request hold the rest. A worktree, on the server or the laptop, is only a cache, so a Stage can run live on the laptop and the next one overnight.
- Its credentials: a `claude setup-token` OAuth token, a fine-grained GitHub token for this repo, and a Linear OAuth app authorized with `actor=app`. With the app, the Runner's comments and assignments come from its own identity, so they notify the Maintainer, and a comment from the Maintainer's account is always theirs. On GitHub the Runner acts as the Maintainer, so it reads only `claude-review`'s and Codex's comments there. The Maintainer's input goes through Linear, which is private.
