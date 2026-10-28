# Edge follows `main`, and a Release promotes Edge's images to Production

Beside the Previews, two long-lived installations run on the home server: Edge at `preview.banki.dkomeza.com`, which follows `main`, and Production at `banki.dkomeza.com`, which runs Releases and holds the User's real data. Both keep their data across deploys and migrate it in place. Every push to `main` builds multi-arch images and creates an `edge` Deployment. release-please keeps a Release PR open; when the Maintainer merges it, the workflow tags the Release, waits for Edge's Deployment of that same commit to succeed, re-tags that commit's images by digest as `vX.Y.Z`, and creates a `production` Deployment; only once Production reports success does `latest` move to them. The same pull agent deploys both (ADR-0008), from a third pool of its own, so Edge exercises exactly the deploy, the migration and the images that Production will get. This amends ADR-0008, under which the agent ran only Previews.

## Considered Options

- **Edge as a disposable Preview of `main`**, reseeded on every merge: rejected. It would show nothing PR Previews don't, and the one bug they can't catch, a migration that breaks existing data, would reach Production first.
- **Rebuilding a Release's images from its tag**: rejected. The images that ship would not be the ones Edge ran.
- **Pushing deploys from Actions** (a webhook or SSH): rejected, for the reasons in ADR-0008, which weigh more with the User's real data behind them.
- **A second agent for Edge and Production**: rejected. It would share the same Docker daemon, so it adds no isolation, only a second copy of the deploy, health check and self-update code.
- **A manual or scheduled release workflow**: rejected for release-please, whose Release PR lets the Maintainer read the notes as a diff and release by merging it.
- **CalVer**: rejected for SemVer, starting at `0.1.0`, which tells self-hosters and future clients (ADR-0002) when a Release breaks something.
- **Release branches for hotfixes**: rejected. A fix merges to `main` and ships with the next Release, which carries everything on `main`.
- **A GitHub App for release-please**, so CI runs on the Release PR: rejected. Its key would have to live where Actions can read it. The Release PR, opened with `GITHUB_TOKEN`, runs no workflows, so the Maintainer merges it with the ruleset's admin bypass; CI runs on `main` right after.
- **Edge and Production behind the Previews' Newt**: rejected. Previews can reach each other's `web`, and must never reach Production's.

## Consequences

- Each Edge or Production deploy takes a Snapshot of the database (`VACUUM INTO`), migrates, and runs the health check; on a failure it restores the Snapshot and the previous image. The last five Snapshots are kept. Off-site backups are not covered here.
- A Release reaches Production only after Edge has run its commit, so a migration that broke Edge never touches the User's data. A Release that Edge or Production failed on is marked not shipped in its notes, and `latest` stays on the last one Production ran.
- Edge and Production have their own Pangolin site and Newt, on a network no Preview joins. Their two resources are fixed, so a one-off bootstrap creates them, and the agent has no Pangolin access to that site.
- Edge and Production reach the internet, unlike Previews: they run only code that was merged.
- Edge is set up once with `banki setup` and `banki seed` (ADR-0007), with an Email and Password of its own that no Preview shares, and is reset to Seed data only by a `reset edge` workflow. Production goes through Setup once by hand. Both keep their `AUTH_SECRET` across deploys and use a `__Host-` sign-in cookie.
- `main` images are built natively for amd64 and arm64 and merged into one manifest; PR and Slug images stay amd64 only. A sweep keeps the newest ten `main` builds, never deletes one tagged `v*`, and PR cleanup never touches them.
- Release notes are for the User and self-hosters. Commits that touch only `deploy/`, `.github/`, `.claude/`, `docs/`, `scripts/` or the repo's own docs (`README.md`, `CONTEXT.md`, `AGENTS.md`, `CLAUDE.md`) are left out, since infrastructure changes nearly always touch the docs too, and the Maintainer edits the rest in the Release PR. They live in the GitHub Release and `CHANGELOG.md`, and Settings shows the version, linking to its Release. Edge shows its version with the commit.
