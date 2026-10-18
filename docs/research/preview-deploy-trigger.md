# From a GitHub Actions event to a preview on the home server, without running PR code there

Research for [BAN-79](https://linear.app/banki-group/issue/BAN-79) (map: BAN-77, per-PR UI previews). Checked on 2026-10-18 against GitHub Docs, official tool docs and repos, and advisories. Every claim has a numbered source in [Sources](#sources).

## The question

When a same-repo PR is opened, pushed to, or closed, the home server has to start, rebuild or remove that PR's preview stack. The home server runs Docker behind NAT, and the internet reaches it only through a VPS or tunnel ingress (Pangolin, frp or Cloudflare Tunnel; not chosen yet). The repo is public, so no self-hosted runner, and no code from GitHub may run directly on the home server. What is the safest simple path? The answer below is a recommendation with trade-offs, not a setup.

## Answer

**Build on GitHub, pull at home.** GitHub-hosted runners build both images on `pull_request` and push them to GHCR, tagged `pr-<N>` and `sha-<head sha>`. A small reconcile loop on the home server (option b, the pull agent) polls the GitHub API for open same-repo PRs every 30 to 60 s. It runs each one as `docker compose -p banki-pr-<N>` from a **compose template kept on the server**, using the images pinned by digest, and tears down any project whose PR is no longer open.

- **No inbound path and no deploy secret in Actions.** Nothing in GitHub can push a command to the home server. Nothing worth stealing sits in the repo's Actions secrets. The only GitHub write credential the server holds is a fine-grained token for one repo with Deployments write, used to report status.
- **Reconciling also tears previews down.** Teardown is "not in the open-PR list any more", so a missed event, a crash or a force-merge can't leave an orphan behind. Eviction (oldest first, cap of 5, 7 days idle) fits into the same loop.
- **The real attack surface is the preview container, not the trigger.** PR code runs inside the preview by design. Whatever the trigger, isolation comes from the server-side template: an `internal: true` network shared only with the ingress proxy (no egress and no LAN, so no Home Assistant), memory, CPU and PID limits, `read_only`, `cap_drop: [ALL]`, `no-new-privileges`, no Docker socket and no host mounts. Docker `userns-remap` or rootless mode is the next layer.
- **The trade-offs.** Up to one poll interval of latency. A small custom program to own (about 100 to 200 lines plus a template). A token for status reporting. No off-the-shelf tool fits better (see [option d](#d-off-the-shelf-self-hosted-preview-tools)).

If push latency ever matters, add a **GitHub repository webhook** (option a3) as a signal that only wakes the loop early. Its HMAC secret lives only in GitHub's repo settings and on the server, never in Actions, and a forged ping can only make the loop poll sooner.

## Ground truth: GitHub Actions and GHCR

### Triggers and secrets

- **`pull_request` runs the PR's own code.** By default it fires only on `opened`, `synchronize` and `reopened`, so `closed` has to be listed in `types` [1]. `GITHUB_SHA` is the merge commit and `GITHUB_REF` is `refs/pull/<N>/merge` [1]. The workflow file itself comes from the PR, so the PR author can rewrite it.
- **Forks are already shut out.** For fork PRs, "secrets are not passed to the runner" apart from `GITHUB_TOKEN`, and that token is read-only [1][2]. A fork PR therefore cannot push to GHCR. The "same-repo only" rule comes for free and is worth enforcing again in `if:` (as `claude-review.yml` already does) and in the agent.
- **A same-repo PR branch means write access.** GitHub's hardening guide: "Any user with write access to your repository has read access to all secrets configured in your repository" [3]. A PR author can edit the workflow in their branch and print any repository secret. **Treat every repository-level secret as readable by anyone who can push a branch.** That includes a compromised account or agent token.
- **Branch policies protect environment secrets.** Environment secrets reach only jobs that reference the environment [4]. With "Selected branches" set to `main` only, a `pull_request` job (ref `refs/pull/<N>/merge`) can't get them. You have to add `refs/pull/*/merge` explicitly to let PR runs in [4]. `workflow_run` and `pull_request_target` run with `GITHUB_REF` set to the default branch [1], so they *can* get them. Environments, branch policies and required reviewers are free for public repos [4].
- **`pull_request_target` runs the base branch's workflow.** It runs "in the context of the default branch of the base repository", has write access and secrets, and GitHub says "Avoid using this event if you need to build or run code from the pull request" [1][3]. It is safe for a job that never checks out or runs PR code, such as teardown on `closed`.
- **`workflow_run` is the privileged half of a split.** It runs from the default branch with secrets and write tokens, even when the triggering workflow had neither. It fires whatever the triggering run's conclusion, and chains go at most three deep [1]. Anything it reads from the triggering run (artifacts, the PR number) is untrusted input [3].
- **`GITHUB_TOKEN`:** it expires when the job ends, or after at most 6 h on hosted runners [5]. Its rate limit is 1,000 requests/h per repo [6]. Events it causes don't start new workflow runs, apart from `workflow_dispatch` and `repository_dispatch` [5]. Its permission keys include `packages`, `deployments`, `pull-requests` and `id-token` [7].
- **OIDC:** a job with `id-token: write` can get a JWT from `https://token.actions.githubusercontent.com`. Its claims include `repository`, `ref`, `event_name`, `job_workflow_ref` and `environment`. `sub` is `repo:OWNER/REPO:environment:NAME` for a job with an environment and `repo:OWNER/REPO:pull_request` for a PR job [8]. A receiver can check these claims instead of holding a shared secret.

### GHCR

- **Login and permissions.** CI logs in with `GITHUB_TOKEN` and needs `packages: write`. GitHub's own example also grants `attestations: write` and `id-token: write` so it can attach build provenance with `actions/attest` [9].
- **Visibility.** A package is **private when first published**. Packages pushed from the command line are not linked to a repo unless the image carries the `org.opencontainers.image.source` label. Public images can be pulled anonymously [10]. Make the two packages public once, and the home server needs no registry credential.
- **Cost.** Container registry storage and bandwidth are "currently free", with a month's notice before that changes. Public packages are free in general [11]. Cleanup is hygiene, not cost.
- **Tags.** `docker/metadata-action` turns `type=ref,event=pr` into `pr-<N>`. With `DOCKER_METADATA_PR_HEAD_SHA=true`, `type=sha` uses the PR's **head** commit instead of the merge commit [12]. Use the full SHA (`format=long`) so the agent can match it exactly against `head.sha` from the API.
- **Cleanup.**
  - A workflow can delete versions with `GITHUB_TOKEN` if the repo has `admin` on the package, which the publishing repo gets by default. GitHub labels deletion from workflows a public preview [13].
  - Deleted versions can be restored within 30 days [13].
  - **"You cannot delete a public package if any version of the package has more than 5,000 downloads"** [13]. Home-server pulls count as downloads, so delete whole PR versions on close, not just once in a while.
  - `actions/delete-package-versions` selects versions by ID, regex on the version name, count, or untagged. It can't select by tag directly [14].
  - Practical shape: on `closed`, look up the version IDs carrying `pr-<N>` or its `sha-*` tags through the REST API and delete them. Add a scheduled sweep of untagged versions.
- **Tag hijacking.** A PR author's rewritten workflow holds `packages: write` and can push **any** tag, including another PR's `sha-*` or a future production tag. For previews that's within the threat model, since they could push to that PR's branch anyway. For **production later**: deploy only by digest produced by a `push`-to-`main` workflow, or verify the provenance attestation's signer workflow and ref (`gh attestation verify`), or publish production to a separate package.

### Reporting back to the PR

- **Deployments API.**
  - Create a deployment with `ref` (the head SHA), `environment`, `transient_environment` and `required_contexts: []`. Then set statuses `in_progress`, `success` (with `environment_url`, which becomes the PR's "View deployment" button) or `failure`. Setting a transient deployment to `inactive` shows it as destroyed [15][16].
  - `auto_inactive` (default `true`) marks earlier *non-transient* deployments in the **same environment** inactive [16]. Use one environment per PR (`preview/pr-<N>`), or mark the deployments transient, so PRs don't deactivate each other.
  - Users with push access can create statuses. Classic tokens need `repo_deployment` [16].
- **Environments pile up.** Referencing an environment creates it [17]. One per PR means many environments, and deleting one through the REST API needs a classic token with `repo` [18], which `GITHUB_TOKEN` can't do. Options: let them accumulate, sweep them now and then with an admin token, or share one `preview` environment with transient deployments.
- **Sticky comment.** The pattern `claude-review.yml` already uses (find your comment by a marker and PATCH it) works with `GITHUB_TOKEN` and `pull-requests: write`. The preview URL is predictable (`pr-<N>.<preview domain>`), so CI can post it before the deploy finishes, and the deployment status then carries readiness.

## What PR code can do on the home server, whatever the trigger

The images contain the PR's code, so anyone who can push a same-repo branch can run arbitrary code **inside the preview containers**. The trigger only decides whether they can do *more* than that. Four rules close the gap:

1. **The compose file must not come from the PR.** A PR's `compose.yaml` could add `privileged: true`, mount `/var/run/docker.sock`, use `network_mode: host` or bind `/`. The deployer uses a template it owns. The only values that come from GitHub are the PR number (an integer) and the head SHA (40 hex characters), both validated, plus image digests from `ghcr.io/dkomeza/banki-{api,web}` only. An image's own config (`USER`, `VOLUME`, `HEALTHCHECK`, env) cannot grant host privileges.
2. **Network.** Containers on the same bridge reach each other freely, and bridges masquerade out to the host's networks [19]. That means the home LAN, the router and Home Assistant. A Compose network with `internal: true` is "externally isolated" [20]. Put each preview on its own internal network that only the ingress proxy also joins. The app needs no egress today; M6's OpenRouter is a later decision.
3. **Resources.** Set `mem_limit`, `cpus` and `pids_limit` per service, plus a disk quota or tmpfs size so one preview can't starve Jellyfin and the rest. Keep `read_only`, `cap_drop: [ALL]` and `no-new-privileges` from the existing `compose.yaml`.
4. **Container escape.** `userns-remap` maps container root to an unprivileged host UID. It is incompatible with `--network=host` and `--privileged`, and it hides existing images when enabled, so it is best turned on before anything else runs [21]. Rootless Docker goes further. gVisor (`runsc`) is the strongest option if wanted. Both Banki images already run as non-root (`USER bun`, `USER caddy`).

**Also worth knowing:**

- **The preview account is visible to PR code.** The Email and Password reach the container through its environment, so they are shared with every PR author. That's fine as long as the account opens only previews.
- **Cookie tossing.** Previews on subdomains of the production domain can set cookies for the parent domain (RFC 6265 `Domain` attribute [22]). If production ever lives on `example.com`, put previews on a **separate registrable domain**, or at least keep production's cookies host-only. Banki's cookies come from better-auth (ADR-0005), so check that it sets no `Domain`.
- **The deployer is the root-equivalent part.** Whatever drives `docker` holds the Docker socket, which is as good as root. It must never pass PR-controlled strings to a shell.

## The options

The four options compared at a glance (details for each below):

| | (a) Webhook receiver | (b) Pull agent | (c) SSH forced command | (d) Off-the-shelf |
| --- | --- | --- | --- | --- |
| Inbound path to the home server | Yes, over HTTP(S) through the ingress | **None** | Yes, raw TCP through the ingress | Yes (GitHub App, webhook or API) |
| Long-lived secret in Actions | a1: HMAC; a2 (OIDC): none; a3: none (secret is in repo settings) | **None** | SSH private key | API token |
| What a stolen secret allows | Redeploy or tear down real PRs, if the receiver re-checks GitHub | Nothing (there is none) | Run the forced command | Whatever the tool's API allows |
| Teardown | Event plus reconcile backstop | **Built in (reconcile)** | Event plus reconcile backstop | Automatic for Git-triggered previews only |
| Status to the PR | Synchronous: workflow posts it | Agent posts with a scoped token, or workflow polls the URL | Synchronous: workflow posts it | GitHub App comments (Coolify) |
| Latency | Seconds | One poll interval | Seconds | Seconds |
| Moving parts | Receiver, public endpoint, reconcile anyway | Agent, read token, status token | sshd exposed, key rotation, TCP ingress | A whole PaaS, with root over SSH |

### (a) An authenticated webhook receiver

**How it works.** A small HTTP service on the home server, published through the ingress, receives "deploy PR N at SHA S" or "remove PR N" and runs the template. There are three ways to authenticate the call:

- **a1, shared HMAC or token from Actions.** The secret has to sit in an environment restricted to `main`, used by a `workflow_run` job (after the PR build) and a `pull_request_target` `closed` job. Neither job checks out PR code. As a plain repository secret, any branch author could read it [3].
- **a2, GitHub OIDC instead of a secret.** The receiver checks the JWT's signature against GitHub's issuer, and checks `repository`, `ref == refs/heads/main`, `event_name` and `job_workflow_ref` [8]. There is nothing long-lived to steal, and a PR job's token says `pull_request` and `refs/pull/...`, so it is refused. The cost is JWT validation code in the receiver.
- **a3, a GitHub repository webhook straight to the receiver.** No Actions involvement. GitHub signs each delivery with `X-Hub-Signature-256` (HMAC-SHA256, compared in constant time) [23]. The secret lives only in the repo settings, which need admin to change, and on the server. The catch: "GitHub does not automatically redeliver failed deliveries" [24], so a receiver that is down misses events. It needs a reconcile loop anyway, which is option b.

**An attacker controlling a PR branch** gets code execution in their own preview, bounded by the rules above. Under a1 they can also steal the secret if it isn't environment-protected.

**With a stolen secret (a1),** the damage depends on what the receiver accepts. If it accepts only `{pr, sha}` and checks with GitHub that the PR is open, from the same repo, and has that head SHA, the worst case is redeploying or tearing down real previews: a nuisance. If it accepted image names or compose fragments in the payload, the attacker could run any image on the server. Add a timestamp and nonce against replay.

**Teardown:** a `pull_request_target` `closed` job calls "remove" (a1/a2), or the receiver reacts to the `pull_request` `closed` webhook (a3). Either way you still need a reconcile backstop for missed calls.

**Status:** with a synchronous receiver, the workflow knows the result and posts the deployment status and comment itself with `GITHUB_TOKEN`. That's the cleanest status story of all the options.

**What you maintain:**

- **An internet-facing endpoint, which is the main cost.** Its parser and auth code are attack surface. Two real examples:
  - Coolify had an unauthenticated deploy trigger through an HMAC bypass when no secret was configured (GHSA-w8wm-r924-f65v, High, fixed in v4.0.0-beta.474, June 2026) [25].
  - Pangolin before 1.22.0 let a share link bypass every resource auth method (CVE-2026-72001, published 2026-08-31) [26].

  So ingress auth (Pangolin auth or Cloudflare Access service tokens [27]) is a useful outer layer, but the receiver must authenticate on its own.
- **The receiver itself.** `adnanh/webhook` (latest 2.8.3, Feb 2026, with release gaps of several months [28]) or ~50 lines of your own.
- **A reconcile loop**, anyway.

### (b) A pull agent on the home server (recommended)

**How it works.** A long-running loop in its own container. It holds the Docker socket, which makes it the trusted, root-equivalent component, so keep it tiny. Every 30 to 60 s it:

1. Lists open PRs and keeps those whose `head.repo` is `dkomeza/banki`.
2. For each, checks that `ghcr.io/dkomeza/banki-{api,web}:sha-<head>` exist, resolves them to digests, and (re)starts `banki-pr-<N>` from the template if the digest changed. That covers "rebuilt on every push from a fresh database": drop the volume before starting.
3. Runs `compose down -v` for every project whose PR isn't open, and applies the cap of 5 (oldest first) and the 7-day idle rule.

**API budget.** Unauthenticated requests get 60/h per IP. A token gets 5,000/h [6]. A fine-grained token with no permissions selected still reads all public repos [29]. That makes it a read-only credential worth nothing to a thief.

**An attacker controlling a PR branch** gets code execution in their own preview. They can also push images to any tag (see [Tag hijacking](#ghcr)), which affects only previews. The agent never reads anything else from the PR: no compose file, no labels turned into config, no payload.

**With a stolen workflow secret:** there is none to steal. The build job holds only a job-scoped `GITHUB_TOKEN` [5]. The agent's tokens live only on the home server.

**Teardown:** built into the reconcile step. The image cleanup in GHCR stays in CI, on `closed` (see [Cleanup](#ghcr)).

**Status**, two variants:

- **Agent reports (preferred).** A fine-grained token for this one repo with Deployments write. The agent creates the deployment and its statuses (`in_progress`, then `success` with `environment_url`, then `inactive` on teardown). If stolen, someone can only forge deployment statuses. CI posts the sticky comment with the predictable URL using `GITHUB_TOKEN`.
- **No credential on the server.** After pushing, CI polls `https://pr-<N>.<domain>/api/health` until it reports the expected commit, then sets the status with `GITHUB_TOKEN`. The cost is runner minutes spent waiting, and the health endpoint has to expose the commit. Today it returns only `{status, database}`. The response is PR-controlled, so a lying preview only fools its own status.

**What you maintain:** the agent (small, but yours), two tokens (read, and Deployments), the template, and the CI build and cleanup jobs. Latency is up to one interval. A3's webhook can wake the loop early without becoming a trust path.

### (c) SSH over the tunnel with a forced command

**How it works.** A `workflow_run` job (and a `pull_request_target` `closed` job) SSHes in with a key held in a `main`-restricted environment. The key's `authorized_keys` line uses `restrict,command="/usr/local/bin/preview-ctl"`: `restrict` turns off forwarding, the PTY and `~/.ssh/rc`, and the client's command arrives only in `SSH_ORIGINAL_COMMAND` [30]. `preview-ctl` accepts only `deploy <int> <40-hex>` and `remove <int>`. `from=` can't help, since GitHub-hosted runner IPs are broad and change.

**An attacker controlling a PR branch:** same as option a. They can steal the key only if it isn't environment-protected.

**With a stolen key:** they can call `preview-ctl` with any arguments it accepts. With the same GitHub check as in option a, that means redeploying or tearing down real previews. Any parsing bug in `preview-ctl` or sshd is reachable from the internet.

**Teardown and status:** the same as a1. Synchronous, so the workflow posts the status itself.

**What you maintain:**

- **A raw TCP path to sshd through the ingress.** Pangolin's raw TCP resources "do not enforce Pangolin authentication or access rules" and must be enabled with `allow_raw_resources` [31], so sshd would face the internet directly. Cloudflare Tunnel can put Access in front (a service token [27] and `cloudflared` on the runner). frp gives you a plain TCP forward.
- **Host key pinning** in the workflow and **key rotation**.
- **A reconcile backstop**, anyway.

This option has the most moving parts for the same result as a1.

### (d) Off-the-shelf self-hosted preview tools

Checked against the constraints: compose (two containers), prebuilt GHCR images only, same-repo PRs only, and no inbound path from GitHub.

- **Coolify v4.4.6 (2026-10-09)** [32]. It has native previews through a GitHub App or webhook, which is inbound.
  - Git-based previews build on the server, and its docs warn "A pull request can run code on the deployment server" [33].
  - A **Docker Image** app can be previewed from a prebuilt per-PR tag ("useful when an external CI system builds one image tag for each pull request"), through the API with `pull_request_id` and `docker_tag` [33][34]. That is single-image only, though: api and web would be two apps, with undocumented wiring between them.
  - Automatic teardown covers only "automatically created" previews [33].
  - "Repository members only" blocks fork PRs [33].
  - It runs Postgres, Redis and Traefik or Caddy, and drives the host as root over SSH [35].
  - It has a long run of 2025 and 2026 root-RCE and auth advisories, including the HMAC bypass above [25].
- **Dokploy v0.30.8 (2026-09-29).** Previews always build on the server ("external people can execute builds and deployments in your server") [36]. Prebuilt-image previews and compose previews are open requests [37]. It needs Swarm, Traefik and free ports 80, 443 and 3000.
- **CapRover v1.15.4.** No native previews [38].
- **Dokku v0.38.31.** Review apps exist, but CI drives them over SSH, they build on the host (even `git:from-image` runs a Dockerfile build), and they are single-app [39].
- **Kamal.** No native previews; per-PR destinations are a community pattern [40].
- **Komodo v2.3.3.** Good compose and registry handling, with signed webhooks, but no previews: you write the preview logic yourself [41].

**Verdict:** none fits. Coolify comes closest, but it would mean running a heavy root-on-host PaaS with an inbound path and a weak advisory record, only to deploy two images and still lose compose wiring and teardown for API-created previews.

## Facts later tickets depend on

- **Workflows.** Same-repo PRs get secrets and a writable `GITHUB_TOKEN`; forks get neither. Put any deploy secret in an environment restricted to `main`, and never in a `pull_request` job.
- **Build tags.** `pull_request` builds should set `DOCKER_METADATA_PR_HEAD_SHA=true` and tag `sha-<full head sha>` plus `pr-<N>`. Add the `org.opencontainers.image.source` label, and make both packages public once after the first push.
- **GHCR cleanup.** Delete PR versions on `closed` by version ID. Watch the 5,000-download rule for deleting public packages. Deletion from workflows is a public preview.
- **The agent's API budget.** Reconcile needs a token (60/h unauthenticated is too tight). A fine-grained token with no permissions reads public repos.
- **Deployments.** Use one environment per PR, or transient deployments, so `auto_inactive` doesn't deactivate other PRs. Per-PR environments pile up, and deleting them needs a classic `repo` token.
- **The health endpoint.** `/api/health` doesn't report a version today. CI-side readiness polling would need it, for example from a build arg.
- **The preview domain.** Use a separate registrable domain for previews if production will share the parent domain (cookie tossing).
- **The ingress.** It only needs to forward HTTPS for `*.<preview domain>` to the proxy on the home server. With option b nothing else is exposed. Pangolin raw TCP resources are unauthenticated, which counts against option c on Pangolin.

## Open questions (not researched here)

- Which ingress is chosen, and whether wildcard TLS for `*.<preview domain>` (Let's Encrypt DNS-01 through Cloudflare) terminates on the VPS or at home.
- Rootless Docker or `userns-remap` on a host that already runs other services: the effort to migrate.
- Whether to verify provenance attestations in the agent now, or only for production later.

## Sources

1. GitHub Docs, Events that trigger workflows. https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows
2. GitHub Docs, Using secrets in GitHub Actions. https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets
3. GitHub Docs, Secure use reference. https://docs.github.com/en/actions/reference/security/secure-use
4. GitHub Docs, Deployments and environments. https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments
5. GitHub Docs, GITHUB_TOKEN. https://docs.github.com/en/actions/concepts/security/github_token
6. GitHub Docs, Rate limits for the REST API. https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api
7. GitHub Docs, Workflow syntax (`permissions`). https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax
8. GitHub Docs, OpenID Connect reference. https://docs.github.com/en/actions/reference/security/oidc
9. GitHub Docs, Publishing Docker images. https://docs.github.com/en/actions/tutorials/publish-packages/publish-docker-images
10. GitHub Docs, Working with the Container registry. https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry
11. GitHub Docs, GitHub Packages billing. https://docs.github.com/en/billing/concepts/product-billing/github-packages
12. docker/metadata-action README. https://github.com/docker/metadata-action
13. GitHub Docs, Deleting and restoring a package. https://docs.github.com/en/packages/learn-github-packages/deleting-and-restoring-a-package
14. actions/delete-package-versions README. https://github.com/actions/delete-package-versions
15. GitHub REST, Deployments. https://docs.github.com/en/rest/deployments/deployments
16. GitHub REST, Deployment statuses. https://docs.github.com/en/rest/deployments/statuses
17. GitHub Docs, Managing environments for deployment. https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments
18. GitHub REST, Deployment environments. https://docs.github.com/en/rest/deployments/environments
19. Docker Docs, Bridge network driver. https://docs.docker.com/engine/network/drivers/bridge/
20. Docker Docs, Compose file `networks` (`internal`). https://docs.docker.com/reference/compose-file/networks/
21. Docker Docs, Isolate containers with a user namespace. https://docs.docker.com/engine/security/userns-remap/
22. RFC 6265, HTTP State Management Mechanism, §4.1.2.3 (Domain). https://www.rfc-editor.org/rfc/rfc6265#section-4.1.2.3
23. GitHub Docs, Validating webhook deliveries. https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries
24. GitHub Docs, Handling failed webhook deliveries. https://docs.github.com/en/webhooks/using-webhooks/handling-failed-webhook-deliveries
25. Coolify advisory GHSA-w8wm-r924-f65v (CVE-2026-41896); index of all advisories. https://github.com/coollabsio/coolify/security/advisories/GHSA-w8wm-r924-f65v, https://github.com/coollabsio/coolify/security/advisories
26. OSV, CVE-2026-72001 (Pangolin < 1.22.0). https://osv.dev/vulnerability/CVE-2026-72001
27. Cloudflare Docs, Service tokens. https://developers.cloudflare.com/cloudflare-one/identity/service-tokens/
28. adnanh/webhook releases. https://github.com/adnanh/webhook/releases
29. GitHub Docs, Managing your personal access tokens. https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens
30. OpenBSD sshd(8), AUTHORIZED_KEYS FILE FORMAT. https://man.openbsd.org/sshd.8
31. Pangolin Docs, Raw resources. https://docs.pangolin.net/manage/resources/public/raw-resources
32. Coolify releases. https://github.com/coollabsio/coolify/releases
33. Coolify Docs, GitHub preview deployments. https://coolify.io/docs/applications/ci-cd/github/preview-deploy
34. Coolify API, Deploy by tag or UUID. https://coolify.io/docs/api-reference/api/operations/deploy-by-tag-or-uuid
35. Coolify Docs, Installation, proxies and firewall. https://coolify.io/docs/get-started/installation, https://coolify.io/docs/knowledge-base/server/proxies, https://coolify.io/docs/knowledge-base/server/firewall
36. Dokploy Docs, Preview deployments; releases. https://docs.dokploy.com/docs/core/applications/preview-deployments, https://github.com/Dokploy/dokploy/releases
37. Dokploy issues #2386, #2028. https://github.com/Dokploy/dokploy/issues/2386, https://github.com/Dokploy/dokploy/issues/2028
38. CapRover, Deploy from GitHub; releases. https://caprover.com/docs/ci-cd-integration/deploy-from-github.html, https://github.com/caprover/caprover/releases
39. dokku/github-action and Dokku image deployment docs. https://github.com/dokku/github-action, https://dokku.com/docs/deployment/methods/image/
40. Kamal discussion #1591. https://github.com/basecamp/kamal/discussions/1591
41. Komodo webhooks docs and releases. https://github.com/moghtech/komodo/blob/main/docsite/docs/automate/webhooks.md, https://github.com/moghtech/komodo/releases
