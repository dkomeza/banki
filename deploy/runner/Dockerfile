# syntax=docker/dockerfile:1

# The Runner (ADR-0012): one image for both its containers, the broker and
# the runner, built on the home server from a checkout of `main`. Build
# context: deploy/runner. Everything a Stage runs comes from here or from the
# clone of `main` in the volume, never from a registry tag a pull request
# could push.

# Only the bun binary is taken from here. The tag moves together with
# `packageManager` in the root package.json.
FROM oven/bun:1.4.3-slim@sha256:14a223fa35747ec728bce300ef85888bc5f7958164d15bbba6a54b22b52a3288 AS bun

# Node, for what the root checks and the `ui` script run on (tsc, oxlint,
# oxfmt, vitest, Playwright), at the major `.node-version` names.
FROM node:24.22.1-trixie-slim@sha256:43b9ba1142b8dcf33fa8f922ca1be85714adc444e0586c7cf7726daaeabc1bea

ARG TARGETARCH

# git, and curl for the wrappers that reach the broker's socket. From the
# Debian release the base image pins.
RUN apt-get update \
  && apt-get install --yes --no-install-recommends ca-certificates curl git \
  && rm -rf /var/lib/apt/lists/*

# gh, from its release, checked against the release's checksums. It goes
# outside PATH: the `gh` on PATH is bin/gh, which hands it a token from the
# broker on every call.
ARG GH_VERSION=2.102.0
RUN set -eu; \
  case "$TARGETARCH" in \
    amd64) sum=bb766f710eef8ede859c18578c72c327597cd4c8a85b06001b1f3843c6019386 ;; \
    arm64) sum=7862c86c72f43df3a2d93ddde6f473285b4e2af61b494849846827e513ef6484 ;; \
    *) echo "No gh for $TARGETARCH" >&2; exit 1 ;; \
  esac; \
  name="gh_${GH_VERSION}_linux_${TARGETARCH}"; \
  curl --fail --silent --show-error --location --output /tmp/gh.tar.gz \
    "https://github.com/cli/cli/releases/download/v${GH_VERSION}/${name}.tar.gz"; \
  echo "$sum  /tmp/gh.tar.gz" | sha256sum --check --quiet -; \
  tar --extract --gzip --file /tmp/gh.tar.gz --directory /tmp; \
  install -D --mode 755 "/tmp/$name/bin/gh" /usr/local/libexec/gh/gh; \
  rm -rf /tmp/gh.tar.gz "/tmp/$name"

# Chromium's system libraries, as the Playwright the root package.json pins
# lists them. Chromium itself isn't in the image: each worktree installs the
# build its own Playwright wants into PLAYWRIGHT_BROWSERS_PATH on the volume,
# so a Playwright bump on `main` needs no rebuild.
RUN npx --yes playwright@1.64.1 install-deps chromium \
  && rm -rf /var/lib/apt/lists/* /root/.npm

# The claude CLI, pinned. Its auto-updater is off: the root filesystem is
# read-only, and a new version comes with a rebuild.
RUN npm install --global @anthropic-ai/claude-code@2.1.295 \
  && npm cache clean --force

COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
RUN ln -s bun /usr/local/bin/bunx

# git asks the broker for a token whenever github.com wants one.
RUN git config --system credential.https://github.com.helper /opt/banki-runner/bin/git-credential-banki

# The broker, the tick loop and the wrappers. No npm dependencies, so there
# is nothing to install: Bun runs the source.
WORKDIR /opt/banki-runner
COPY broker/ broker/
COPY loop/ loop/
COPY lib/ lib/
COPY bin/ bin/

# The volumes' mount points. A new volume takes its mount point's owner and
# mode from the image, and the containers run as the host user's uid, which
# only Compose knows: so anyone may write there, and each directory under
# them is that user's own.
RUN mkdir -p /work /run/banki-broker && chmod 1777 /work /run/banki-broker

ENV PATH=/opt/banki-runner/bin:$PATH \
  DISABLE_AUTOUPDATER=1 \
  GH_NO_UPDATE_NOTIFIER=1 \
  GH_PROMPT_DISABLED=1

# The commit of `main` this image is built from, last, so a new one rebuilds
# nothing else. The tick loop compares it with `main` on every tick.
ARG BANKI_RUNNER_COMMIT=""
ENV BANKI_RUNNER_COMMIT=$BANKI_RUNNER_COMMIT

# Not the Node image's entrypoint, which would put `node` in front of it.
ENTRYPOINT []
CMD ["bun", "/opt/banki-runner/loop/main.ts"]
