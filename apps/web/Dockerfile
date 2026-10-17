# syntax=docker/dockerfile:1

# The build stages run on the build machine's platform: their output is static
# files, so a multi-arch build needs no emulation for them.

# The Bun tag must move together with `packageManager` in the root package.json.
# Only its binary is used, to install dependencies from bun.lock.
FROM --platform=$BUILDPLATFORM oven/bun:1.4.3-slim@sha256:14a223fa35747ec728bce300ef85888bc5f7958164d15bbba6a54b22b52a3288 AS bun

# Vite runs on Node. Keep the major in step with `.node-version`.
FROM --platform=$BUILDPLATFORM node:24.22.0-slim@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5 AS build
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun

WORKDIR /app
COPY package.json bun.lock bunfig.toml tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile --filter @banki/web

# The web app's workspace dependencies come along too: Vite follows the
# tsconfig references into them, even though @banki/api is imported for types only.
COPY packages/shared packages/shared
COPY apps/api apps/api
COPY apps/web apps/web
RUN bun run --cwd apps/web build

# Caddy serves the built SPA and proxies the API (see the Caddyfile).
FROM caddy:2.11.7-alpine@sha256:d8542f48d34a9cf4e4c11a478865229840e87e4c96ea3f439101f31a5d35f75f

# The upstream image gives the binary the capability to bind ports below 1024.
# Port 8080 doesn't need it, and a file capability outside the bounding set
# (compose drops them all) would make the binary fail to start.
RUN setcap -r /usr/bin/caddy \
    && addgroup -S -g 1000 caddy \
    && adduser -S -D -H -u 1000 -G caddy -s /sbin/nologin caddy \
    && chown caddy:caddy /config /data

COPY apps/web/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/web/dist /srv

USER caddy
EXPOSE 8080
