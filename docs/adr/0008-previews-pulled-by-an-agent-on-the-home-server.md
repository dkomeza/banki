# Previews are pulled from prebuilt images by an agent on the home server

Every open same-repo pull request gets a Preview on the home server. GitHub-hosted CI builds its images and pushes them to GHCR. A pull agent on the home server polls GitHub, runs each Preview from a hardened Compose template with those images, routes it through its own Pangolin resource, and reports back through GitHub Deployments. GitHub never reaches the server, and the server never runs a pull request's code outside a Preview's containers.

## Considered Options

- **Push from GitHub Actions** (a self-hosted runner, or a workflow calling a deploy endpoint): rejected. It needs an internet-facing endpoint or a runner on the server, and a deploy credential in Actions that every pull request branch could read, including the `/work-issue` agents' branches. It would still need a reconcile loop for missed events and teardown.
- **Secrets in GitHub**: rejected. GitHub never returns a secret's value through its API, so the agent couldn't read it anyway, and any branch's workflow can. The agent's secrets live in a `0600` directory on the server, written by `deploy/preview/bootstrap`.
- **Building the images on the server**: rejected, because building runs the pull request's Dockerfile on the server.

## Consequences

- The agent holds the Docker socket, so it is built on the server from a clone of `main` only. Its image never comes from GHCR, where any pull request can push any tag.
- Isolation is by template and networks, not by daemon. Each Preview has an `internal: true` default network, and only its `web` also joins the shared, `internal: true` `banki-previews` network, where a containerized Newt for a Previews-only Pangolin site is the one trusted proxy. The agent never joins `banki-previews`. Previews can reach each other's `web`; `userns-remap` is daemon-wide and would affect the server's other services, so it isn't used.
- A Preview has no internet access. From M6, grading can't reach OpenRouter from a Preview; that is revisited then.
- The agent keeps no state of its own. Docker labels say what is running, and the `preview` Deployments say what was attempted, so a restart loses nothing.
- Previews live at `pr-<N>.banki.dkomeza.com`, beside a future production at `banki.dkomeza.com`. A Preview can set cookies for `dkomeza.com`, so production's sign-in cookie must use the `__Host-` prefix.
