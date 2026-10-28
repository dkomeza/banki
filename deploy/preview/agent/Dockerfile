# syntax=docker/dockerfile:1

# The pull agent (ADR-0008). Built on the home server from a clone of `main`
# only, never pulled from GHCR, where any pull request can push any tag: it
# holds the Docker socket. Build context: deploy/preview.

# Only the static docker CLI and its Compose and Buildx plugins are taken from
# here: the self-update helper (ADR-0009) builds the agent with Compose, which
# builds through Buildx.
FROM docker:29.9.1-cli@sha256:6fae2214c3121a28d5aa639d09032f61310b7c9c75ffbad1025f261a1b621800 AS docker

# The Bun tag moves together with `packageManager` in the root package.json.
FROM oven/bun:1.4.3-slim@sha256:14a223fa35747ec728bce300ef85888bc5f7958164d15bbba6a54b22b52a3288

# git, for the agent's own clone of `main` (ADR-0009).
RUN apt-get update \
  && apt-get install --yes --no-install-recommends ca-certificates git \
  && rm -rf /var/lib/apt/lists/*

COPY --from=docker /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker /usr/local/libexec/docker/cli-plugins/docker-compose /usr/local/libexec/docker/cli-plugins/docker-compose
COPY --from=docker /usr/local/libexec/docker/cli-plugins/docker-buildx /usr/local/libexec/docker/cli-plugins/docker-buildx

# The templates sit beside the code, where the agent looks for them: the
# Preview and Long-lived templates of the `main` this image is built from.
# The Snapshot script (agent/snapshot.ts) runs from this image too.
WORKDIR /preview
COPY compose.yaml long-lived.compose.yaml ./
COPY agent/*.ts ./agent/

# No npm dependencies, so there is nothing to install: Bun runs the source.
CMD ["bun", "agent/main.ts"]
