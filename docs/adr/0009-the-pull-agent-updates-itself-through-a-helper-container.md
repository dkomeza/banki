# The pull agent updates itself from its own clone of `main` through a helper container

The Preview pull agent (ADR-0008) keeps its own clone of `main` in a Docker volume. On each loop it fetches `main` anonymously into that clone. When anything under `deploy/preview/` differs from the commit the running agent was built from, it starts a detached one-shot helper container from its own image, with the socket, the clone and the secrets directory mounted. The helper runs `docker compose … up -d --build` on the clone's `agent.compose.yaml`, which rebuilds the agent and replaces it. The agent can't do that itself: recreating its own container would kill the `docker compose` call halfway. A failed build leaves the old agent running.

## Considered Options

- **Updating by hand** (`git pull && docker compose … up -d --build`): rejected. A merged fix to the agent or the Preview template does nothing until someone remembers to log in to the server.
- **A systemd timer on the host** running that same command as the user: rejected. It's simpler, but it lives outside Docker and outside the repo's control, it's one more thing to install on the server, and it only knows to rebuild, not when.
- **Watchtower, or any image pulled from a registry**: rejected by ADR-0008. The agent holds the Docker socket, so its image is only ever built on the server from `main`.
- **Updating the checkout the agent was started from**: rejected. The agent runs as root for the socket, so it would leave root-owned files in a person's `.git`, and it would clobber any changes they had there.

## Consequences

- Only `main` is ever fetched, checked out or built. A pull request's branch never reaches the server.
- The agent knows its own commit from `BANKI_PREVIEW_COMMIT`, which the helper sets. An agent started by hand has none, so it moves itself onto `main` on its first loop: whatever a human starts converges on `main`.
- A person's checkout on the server is needed only for `bootstrap` and the first start.
- A change to the Preview template takes effect for each Preview at its next push. Running Previews aren't redeployed.
