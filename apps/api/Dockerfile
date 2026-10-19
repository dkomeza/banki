# syntax=docker/dockerfile:1

# The Bun tag must move together with `packageManager` in the root package.json.
FROM oven/bun:1.4.3-slim@sha256:14a223fa35747ec728bce300ef85888bc5f7958164d15bbba6a54b22b52a3288

WORKDIR /app

# Production dependencies of @banki/api and its workspace dependency
# @banki/shared, installed on the target platform. Only their manifests are
# copied, so a change to the web app's dependencies doesn't bust this layer.
COPY package.json bun.lock bunfig.toml ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --production --frozen-lockfile --filter @banki/api

# Bun runs the TypeScript source directly.
COPY packages/shared/src packages/shared/src
COPY apps/api/src apps/api/src
COPY apps/api/drizzle apps/api/drizzle

# Docker copies this ownership into a fresh named volume mounted at /data, so
# the API can write to it without a manual chown.
RUN mkdir /data && chown bun:bun /data

USER bun
WORKDIR /app/apps/api

HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=30s --start-interval=1s \
    CMD ["bun", "src/healthcheck.ts"]

# Exec form: Bun is PID 1 and gets SIGTERM directly, so it shuts down cleanly.
CMD ["bun", "src/server.ts"]

# The commit `/api/health` reports. The preview-images workflow passes the PR's
# head SHA; a local build leaves it empty, which the API reports as "dev". Last,
# so a new SHA doesn't invalidate the install and copy layers above.
ARG COMMIT
ENV COMMIT=$COMMIT
