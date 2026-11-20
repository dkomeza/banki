# Releases

A [Release](../../CONTEXT.md) is a numbered version of Banki, `v0.1.0` and up, whose images are the very images [Edge](../../CONTEXT.md) ran ([ADR-0017](../adr/0017-edge-follows-main-and-releases-promote-its-images-to-production.md)). The `release` workflow (`.github/workflows/release.yml`) cuts it with [release-please](https://github.com/googleapis/release-please) and ships it to [Production](../../CONTEXT.md). There are no release branches: a hotfix merges to `main` and ships with the next Release.

| Path                            | What it is                                                                           |
| ------------------------------- | ------------------------------------------------------------------------------------ |
| `release-please-config.json`    | How release-please versions the repo and writes the notes                            |
| `.release-please-manifest.json` | The version of the newest Release, which release-please keeps                        |
| `CHANGELOG.md`                  | Every Release's notes, written by release-please (oxfmt leaves it alone)             |
| `.github/workflows/release.yml` | The Release PR on every push to `main`, and the promotion once the Release PR merges |

## Setting it up

Once, in the repo's **Settings**, **Actions**, **General**: turn on **Allow GitHub Actions to create and approve pull requests**. release-please opens the Release PR with `GITHUB_TOKEN`, and can't without it.

## The Release PR

Every push to `main` runs release-please, which keeps one Release PR open, titled `chore(main): release X.Y.Z`. It holds the next version, in the root, `apps/api`, `apps/web` and `packages/shared` `package.json`, in `bun.lock` and in `.release-please-manifest.json`, and the Release's notes, at the top of `CHANGELOG.md` and in its body. One version covers the whole repo, tagged `vX.Y.Z`.

- **The version** is SemVer from the squash-merged PR titles since the last Release: a `feat` bumps the minor version, a `fix` the patch. Before `1.0.0`, a breaking change bumps the minor version too, so `1.0.0` only ever comes from a deliberate `release-as`. The first Release is `0.1.0`, and its notes start at the walking skeleton (BAN-74), leaving out the prototype's commits.
- **The notes** are for the User and self-hosters: a **Features** and a **Fixes** section, and every other commit type left out. So is a commit that touches only `deploy/`, `.github/`, `.claude/`, `docs/` or `scripts/`. A stretch of only such commits opens no Release PR.
- **To edit the notes**, edit the Release PR just before you merge it: its body becomes the GitHub Release, and `CHANGELOG.md` on its branch the changelog. Each push to `main` rewrites the Release PR, edits included. release-please leaves out only whole directories, so an infrastructure `feat` or `fix` that also touched a root doc (`README.md`, `CONTEXT.md`, `AGENTS.md` or `CLAUDE.md`) still lands in the notes: rewrite its entry there as one generic line, such as "Improved release architecture".
- **`bun.lock`** records each workspace's version, so whenever release-please opens or updates the Release PR, the workflow runs `bun install --lockfile-only` on its branch and pushes the new `bun.lock` there, as `github-actions[bot]`. The PR after a Release then carries no lockfile diff.

The Release PR runs no workflows, since `GITHUB_TOKEN` can't trigger them, so its checks never appear. Merge it with the ruleset's admin bypass; CI runs on `main` right after.

**Merge nothing else to `main` until Edge has deployed the Release commit.** Edge deploys only its newest `edge` deployment, so a merge in between supersedes the Release's before Edge runs it, and the Release isn't shipped.

## The promotion

Merging the Release PR makes release-please tag `vX.Y.Z` and create the GitHub Release, and the `promote` job runs in the same run, since a tag pushed with `GITHUB_TOKEN` triggers nothing either. It runs only when release-please created a Release, one at a time across runs, and is never cancelled while it runs. GitHub keeps only the newest promotion waiting behind it, though: a third Release merged meanwhile cancels the one waiting, whose Release is then never promoted, and the newer Release carries it. A wait that GitHub doesn't answer asks again until it runs out, so an API error is never taken for Edge or Production failing.

1. **Wait for Edge.** It polls the `edge` deployments of the Release commit, which [main images](images.md#main-images) creates once that commit's images exist. Edge has run the commit once any of them has a `success` status anywhere in its history. It fails on a `failure` or `error` status, on `inactive` without a `success` before it (a newer merge's deployment superseded it before the agent ran it), or after 60 minutes with neither.
2. **Tag `vX.Y.Z`.** It takes the `api` and `web` digests from that successful deployment's payload, checks that each is the Release commit's `sha-<sha>` manifest, and tags each image by digest as `vX.Y.Z`: both architectures, no rebuild. It reads the tag back, and never moves a `vX.Y.Z` that is already on other images.
3. **Deploy Production.** It creates a `production` deployment of the Release commit, `Production vX.Y.Z`, with those digests in its payload, `queued` (`waiting for the agent`), which the pull agent deploys ([How the agent deploys them](long-lived.md#how-the-agent-deploys-them)). It never creates one of a commit older than Production's newest deployment, so Production never goes back.
4. **Wait for Production.** `success` goes on; `failure`, `error` or `inactive`, or 60 minutes without a result, fails.
5. **Move `latest`.** It tags both images by digest as `latest`, and reads it back.

| Tag      | What it marks                                                                      |
| -------- | ---------------------------------------------------------------------------------- |
| `vX.Y.Z` | The images of Release `vX.Y.Z`, the ones Edge ran. It never moves                  |
| `latest` | The newest Release Production ran. It moves only once Production reports `success` |
| `v0.0.1` | A placeholder pushed by hand, not a Release. It stays                              |

Neither sweep touches `v…` or `latest`: the main-images sweep keeps every version with a tag other than `main` or `sha-…`, and PR cleanup any with a tag other than `pr-…` or `sha-…`.

## An unshipped Release

When Edge fails on the Release commit, or Production fails to deploy it, the Release is **not shipped**. The workflow puts a line at the top of the GitHub Release's notes, "**Not shipped:** Edge failed on this commit" or "Production failed to deploy it", "and the next Release carries the fix", and takes GitHub's **Latest** from it, back to the newest Release Production ran. `latest` doesn't move. The tag and the Release stay, and the run fails red.

Fix it on `main` as usual: the next Release carries the fix, and everything else since.

A promotion that failed on a transient error (GitHub or GHCR not answering, the agent down past the hour) is retried with **Re-run failed jobs** on the run: release-please already succeeded, so it creates no second Release. A re-run that ships the Release takes the "Not shipped" line off and makes it GitHub's Latest again. A re-run whose Production deployment already succeeded doesn't deploy Production again.
