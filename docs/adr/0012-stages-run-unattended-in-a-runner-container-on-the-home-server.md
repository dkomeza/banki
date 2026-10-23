# Stages run unattended in a Runner container on the home server

The `/work-issue` Stages (building Variants, implementing, review rounds, Acceptance fixes) run unattended in a Runner: a container on the home server beside the pull agent, but sharing nothing with it. It has no Docker socket, isn't on `banki-previews` and can't read the pull agent's secrets. Its own volume holds a clone of `main` and the worktrees, and it has a memory cap. Stages run `claude -p` with permission prompts skipped, so the container is the boundary. This amends ADR-0008: the server now runs branch code (tests, the `ui` stack, Playwright) outside a Preview, in the Runner.

## Considered Options

- **GitHub Actions** (`claude-code-action` on a schedule): rejected. The repo is public, and every branch's workflow, including the ones the agents write, could read the Claude token and the Linear key (the reason ADR-0008 keeps secrets out of GitHub).
- **Inside the pull agent's container**: rejected. It holds the Docker socket, and the Stages run code from branches.
- **The laptop**: rejected. It isn't on at night, which is when the Stages run. The laptop still runs Stages live through `/work-issue`.
- **A permission allowlist** instead of skipping prompts: rejected. In `-p` mode a gap in the list makes a Stage fail in the middle of the night, and the container already limits what a Stage can reach.
- **A fine-grained PAT** instead of the GitHub App: rejected. It acts as the Maintainer, an admin, so it could merge, and its comments would look like theirs.
- **The keys in the Stages' container**, readable by the Dispatcher and the Stages alike: rejected. A Stage reads untrusted text with prompts skipped and could be talked into sending the key, which mints tokens until it is revoked by hand. Two Unix users in one container were rejected too: they need `CAP_SETUID` back and a supervisor to start both.
- **Linear's authorization-code grant** with refresh tokens: rejected. Its refresh tokens rotate on every use, so the broker would have to keep each new one, and losing one means authorizing again in a browser.
- **An egress allowlist proxy**: not done for now. It would keep a leaked token from being sent anywhere but the services the Runner needs, at the cost of another container and a list to maintain.

## Consequences

- On each tick the Runner fetches `main` into its clone and runs the Dispatcher and the Stage prompts from it, so a merged change applies on the next tick without a Docker socket (unlike the pull agent, ADR-0009). Only a change to the image needs `docker compose … up -d --build` by hand.
- Stages hand over through origin and Linear only: the issue's description is the spec, and the pushed branches and the pull request hold the rest. A worktree, on the server or the laptop, is only a cache, so a Stage can run live on the laptop and the next one overnight.
- On GitHub the Runner is a private GitHub App installed on this repo only. It has no Workflows or Administration permission, so no Stage can change `.github/workflows/`, where the Actions secrets are. A broker, a second container of the Runner that shares only a socket with it, holds the App's key and mints repo-only tokens that last an hour, so a leaked one dies quickly: the Dispatcher and the Stages ask it for tokens and never see the key. The App isn't an admin, and the `main` ruleset requires an approving review of the last push, so only the Maintainer can make a pull request mergeable. That matters because whatever reaches `main` runs on the server on the next tick, the pull agent with the Docker socket included.
- In Linear the Runner is an OAuth app acting as itself (`actor=app`), so its comments and assignments notify the Maintainer, and a comment from the Maintainer's account is always theirs. It has no `admin` scope. The broker holds its client secret and mints a token per Stage with the client-credentials grant, revoking it when the Stage ends, so the Runner keeps no Linear state and a leaked token lives only as long as its Stage.
- On GitHub the App is a bot, and `claude-code-action` runs for bots only when its `allowed_bots` names them, so `claude-review` allows the Runner's App, and no other.
- Its Claude token is a `claude setup-token` made for the Runner alone, so it can be revoked without touching anything else. That token can't be scoped any narrower.
- A Stage holds all three tokens and has open internet access. The container stops a Stage from reaching the host or the Previews, not from sending what it reads. So the Runner trusts input only from the Maintainer (in Linear, which is private) and from `claude-review` and Codex on GitHub.
