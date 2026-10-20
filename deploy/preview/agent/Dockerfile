# syntax=docker/dockerfile:1

# The pull agent (ADR-0008). Built on the home server from a clone of `main`
# only, never pulled from GHCR, where any pull request can push any tag: it
# holds the Docker socket. Build context: deploy/preview.

# Only the static docker CLI and its Compose plugin are taken from here.
FROM docker:29.9.1-cli@sha256:6fae2214c3121a28d5aa639d09032f61310b7c9c75ffbad1025f261a1b621800 AS docker

# The Bun tag moves together with `packageManager` in the root package.json.
FROM oven/bun:1.4.3-slim@sha256:14a223fa35747ec728bce300ef85888bc5f7958164d15bbba6a54b22b52a3288

COPY --from=docker /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker /usr/local/libexec/docker/cli-plugins/docker-compose /usr/local/libexec/docker/cli-plugins/docker-compose

# The template sits beside the code, where the agent looks for it: the Preview
# template of the `main` this image is built from.
WORKDIR /preview
COPY compose.yaml ./compose.yaml
COPY agent/*.ts ./agent/

# No npm dependencies, so there is nothing to install: Bun runs the source.
CMD ["bun", "agent/main.ts"]
