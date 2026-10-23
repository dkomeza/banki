# Slug Previews are dispatched from `main` and run in a pool of their own

A branch can get a Preview without a pull request: a Slug Preview, reached at `<slug>.banki.dkomeza.com`. A `workflow_dispatch` workflow on `main`, given a branch and a Slug, builds that branch's images and creates a Deployment in the `slug-preview` environment, and the same pull agent runs it (ADR-0008). Slug Previews are a second pool beside PR Previews, with their own cap, eviction, time to live and lower resource limits, so neither pool ever pushes the other's Previews out. This amends ADR-0008, under which only open pull requests got Previews.

## Considered Options

- **Throwaway draft pull requests**, one per prototype variant: rejected. Each one runs CI, Codex and `claude-review`, and clutters the pull requests with branches that are never meant to merge.
- **One Preview with a `?variant=` switch in the app's code**: rejected. Prototype code would have to live in the app behind a switch, and the variants couldn't differ in anything the switch doesn't reach.
- **Dispatching with `--ref <branch>`**: rejected. GitHub runs the branch's own copy of the workflow, which the branch can change, with the token that writes packages and Deployments. Run from `main`, the workflow only checks the branch out to build it.
- **One shared pool with PR Previews**: rejected. A batch of prototype variants would evict the PR Previews under review, or the reverse.
- **A second agent for Slug Previews**: rejected. Two processes would hold the Docker socket and share the Previews' Newt; the deploy, health check, Pangolin and self-update code is the same.
- **Hosts under `slug.banki.dkomeza.com`, or prefixed `slug-<slug>`**: rejected for short, readable links. A second level needs its own Pangolin domain and certificate. The bare host shares its namespace with future subdomains of `banki.dkomeza.com`, so Slugs follow a fixed pattern, never start with `pr-`, and a short list of names is reserved.

## Consequences

- The agent stays stateless. A Slug Preview is wanted while its newest `slug-preview` Deployment isn't `inactive` and its time to live, counted from that Deployment, hasn't run out. Removing one is marking that Deployment `inactive`, which the workflow's `down` does; the time to live is a backstop.
- The workflow refuses a Slug that another branch holds, so a typo can't replace someone else's Slug Preview. A Slug is free again once its Deployment is inactive.
- A Slug Preview doesn't follow its branch: the server never fetches branches, and the agent can't start builds. A push changes nothing until the branch is dispatched again.
- The agent's token can't delete GHCR packages, so the workflow deletes the images of Slugs whose Deployment is inactive, on a `down` and on a schedule.
- Anyone who can dispatch a workflow can get a Slug Preview, which already needs write access to the repo.
