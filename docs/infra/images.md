# Container images

The images CI builds and pushes to GHCR: what each tag marks, and what sweeps them away. The pull agent on the home server only ever pulls them.

## Preview images

For Previews, every push to a pull request from a branch of this repo builds both images for `linux/amd64` on GitHub's runners and pushes them to GHCR as `ghcr.io/<owner>/banki-api` and `ghcr.io/<owner>/banki-web` (`.github/workflows/preview-images.yml`). The home server only pulls them, so no PR code runs there outside a Preview container. Each push adds one version per package, tagged:

| Tag            | What it marks                                                                                                                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pr-<N>`       | The newest push to PR `<N>`; it moves on every push                                                                                                                                                     |
| `pr-<N>-<sha>` | The push of the PR's head commit `<sha>` (the full SHA). The pull agent waits for it and pulls by its digest, and cleanup finds every version PR `<N>` ever pushed by it, since only PR `<N>` pushes it |

When a PR closes, cleanup sweeps both packages and deletes every version of every PR that is no longer open: a version with a `pr-<M>` or `pr-<M>-…` tag whose PR `<M>` is closed, and with no tags but `pr-…` and `sha-…` ones (PR images were once tagged `sha-<sha>` too). A version with any other tag, such as a release's `v1.0.0` or `latest`, is never touched, and neither is a [main build](#main-images), which never has a `pr-<M>` tag. GHCR refuses to delete a package's last tagged version, and a public version downloaded more than 5000 times, so such a version stays: when a closed PR's version is the only one left, until a later cleanup sweeps it after another PR has pushed, or for good once a release version lives in the same package. Pull requests from forks and Dependabot get no images.

[Slug Previews](previews.md#slug-previews) push their images to the same two packages from the `slug-preview` workflow, each build tagged only `slug-<slug>-<sha>`, so PR cleanup never touches them. Their own sweep, after every `down` and once a day, deletes every version whose tags are all `slug-…` tags of Slugs that are down (the Slug's newest `slug-preview` deployment is inactive, or it has none), and never a version with any other tag. It keeps a package's last tagged version, as cleanup does.

## Main images

Every push to `main` builds both images for `linux/amd64` and `linux/arm64`, each natively on its own runner (`.github/workflows/main-images.yml`), and pushes them to the same two packages. Each platform image is pushed by digest, untagged; a merge job then joins each pair into one multi-arch manifest, tagged:

| Tag         | What it marks                                                                                      |
| ----------- | -------------------------------------------------------------------------------------------------- |
| `main`      | The newest build Edge deployed. It moves once the `edge` deployment is created, so never backwards |
| `sha-<sha>` | The build of `main`'s commit `<sha>` (the full SHA). Only main builds have `sha-…` tags            |

Once both manifests exist, the workflow creates an `edge` GitHub deployment of the commit, `queued` (`waiting for the agent`), whose payload holds the commit and the index digests of both images, `{ "sha", "api", "web" }`. The pull agent deploys [Edge](../../CONTEXT.md) from those digests, and [a Release](releases.md) promotes the very same ones (ADR-0017). Edge never goes backwards: when the newest `edge` deployment is of a descendant of the commit, the build finished out of order and creates none, and leaves `main` where it is. No run is ever cancelled, so every commit gets its images, and the workflow doesn't wait for CI on `main`, since every PR passed CI before it merged.

To redeploy Edge, re-run a push's run of the workflow: it finds the images already pushed, skips the builds, and creates a fresh deployment with the same digests.

A sweep, once a day and on `gh workflow run main-images.yml`, keeps the ten newest main builds in each package, and always the one tagged `main`, and deletes the rest along with their platform manifests. A main build is a version whose tags are all `main` or `sha-…`; a version with any other tag, a Release's `v…`, the `v0.0.1` placeholder, a PR's or a Slug's, is never touched. It keeps what GHCR won't delete, as cleanup does. The untagged platform images of a merge job that failed are not swept.

Both packages start out private. Make each one public once, after its first push (on GitHub: the package's **Package settings**, then **Change visibility**), so the home server can pull them without credentials.

`GET /api/health` reports the build it runs: `version`, the api's `package.json` version, which each [Release](releases.md) bumps; `commit`, the commit its image was built from, the full SHA in a preview or main image and `"dev"` in local dev and in images built locally, such as with `docker compose`; and `release`, `true` only when the api runs with `RELEASE=true`, as Production's does ([Long-lived installations](long-lived.md)). Settings shows them as its last line.
