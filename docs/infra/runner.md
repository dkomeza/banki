# Runner

The [Runner](../../CONTEXT.md) runs the `/work-issue` [Stages](../../CONTEXT.md) unattended, at night, on the home server ([ADR-0012](../adr/0012-stages-run-unattended-in-a-runner-container-on-the-home-server.md)). It sits beside the pull agent and shares nothing with it: no Docker socket, not on `banki-previews`, none of `~/.config/banki-preview`. Which Stage runs when is the [Dispatcher](../../CONTEXT.md)'s job ([ADR-0013](../adr/0013-linear-statuses-drive-the-stages-through-a-dispatcher-without-an-llm.md)): a plain program, no LLM, that goes by the issues' statuses, assignees and closing comments, waits on CI and the Previews without spending tokens, and starts Stages only inside a window and under a usage gate ([below](#the-dispatcher)).

It is one Compose project, `banki-runner`, with three containers from one image:

- **broker**, the [Broker](../../CONTEXT.md), holds the GitHub App's private key and the Linear app's client secret, and mints short-lived tokens from them. Nothing else runs there.
- **runner** runs the tick and the Stages. It holds only the Claude token, asks the Broker for GitHub and Linear tokens over a Unix socket, and never sees the keys.
- **dashboard** serves the [Dashboard](../../CONTEXT.md), a read-only web page of what the Runner is doing ([below](#the-dashboard); [ADR-0015](../adr/0015-the-dashboard-reads-through-the-broker-from-a-container-of-its-own.md)). It holds no secret, and reads the runner's volume read-only.

The broker and the runner share only the volume holding the Broker's socket, which the Dashboard mounts too. A Stage runs `claude` with permission prompts skipped and reads untrusted text, so it could be talked into sending whatever it can read: it can mint tokens through the socket, but it can't read the key that makes them, and every token it can get dies on its own. A GitHub token lasts an hour. A Linear token is minted when its Stage starts and revoked when it ends, or 4 hours after it was minted, whichever comes first.

A Stage still holds the Claude, GitHub and Linear tokens while it runs, and has open internet access: there is no egress allowlist (ADR-0012 records the trade-off). The host's firewall rules for the runner's network keep a Stage from the home server's ports and the home LAN ([below](#keeping-it-off-the-host-and-the-lan)), and the Previews' internal networks keep it from the Previews, but nothing keeps it from sending what it reads, so the Stages and the Dispatcher take input only from the Maintainer in Linear (`.claude/skills/work-issue/references/stages.md` § Input).

| Path                          | What it is                                                                                                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `deploy/runner/compose.yaml`  | The three containers, hardened, with their networks, volumes and secrets                                                                                                 |
| `deploy/runner/Dockerfile`    | The image: pinned bun, node, git, gh and the `claude` CLI, and Chromium's system libraries                                                                               |
| `deploy/runner/broker/`       | The Broker (Bun, no npm dependencies): the App's JWT, the GitHub token cache and the Linear tokens' revoke schedule are pure and unit-tested; the rest are thin adapters |
| `deploy/runner/loop/`         | The tick loop: brings the clone onto `main`, runs `tick.ts`, and says when the image is behind `main`                                                                    |
| `deploy/runner/bin/`          | What is on PATH: `gh` and git's credential helper, which ask the Broker for a token on every call, `runner`, and `dashboard`                                             |
| `deploy/runner/tick.ts`       | The tick, run from the clone: it runs the Dispatcher                                                                                                                     |
| `deploy/runner/dispatch/`     | The Dispatcher and the Stages' supervisors. Which Stage is next, the window, the gate, the costs and the waits are pure and unit-tested; the rest are thin adapters      |
| `deploy/runner/cli/`          | `runner status`, `runner run-now` and `runner stage`, run from the clone                                                                                                 |
| `deploy/runner/dashboard/`    | The Dashboard, run from the clone: each page's view and HTML are pure and unit-tested; the server is a thin adapter                                                      |
| `deploy/runner/bootstrap`     | Asks for the Runner's secrets and writes them outside the clone                                                                                                          |
| `deploy/runner/host-firewall` | The host's firewall rules that keep the runner's and the Dashboard's networks off the home server and the LAN                                                            |

The Broker, the tick loop and the wrappers on PATH are baked into the image. The tick script, the Dispatcher, the CLI and the Dashboard run from the clone of `main` in the volume, so a merged change to them applies on the next tick (the Dashboard restarts on it).

## Linear: the statuses and the app

The Stages are driven by the issue's status (`docs/agents/issue-tracker.md` § Statuses, [ADR-0013](../adr/0013-linear-statuses-drive-the-stages-through-a-dispatcher-without-an-llm.md)). In the Banki team's settings, under **Workflow**, add:

- **In Design** and **Design Review**, in the Unstarted category, before Todo;
- **Acceptance**, in the Started category, after In Review.

The Runner is a Linear OAuth app acting as itself, so its comments and assignments come from it and notify you, and a comment from your account is always yours. Create it in **Settings → API → OAuth applications**:

1. Name it **Banki runner**. The callback URL is never used (the Runner doesn't sign in through a browser); give it any HTTPS URL, such as `https://banki.dkomeza.com`.
2. Turn on **Client credentials**. The Runner uses that grant only: Linear doesn't let an app mix grants and still hold several of its tokens at once. Its tokens act as the app (`actor=app`) with the `read` and `write` scopes the Broker asks for, and never `admin`.
3. Note the **client ID** and the **client secret**, for `bootstrap`.

A client-credentials token sees the workspace's public teams only. Keep the Banki team public, or give the app access to it on the app's details page.

A headless Stage reaches Linear through the `linear-banki` MCP server, authenticated as the Runner app (`docs/agents/issue-tracker.md`).

A token minted just after another of the app's was revoked is blind for under a second: it authenticates, but Linear answers `Entity not found` for every issue. The Runner's reads retry that for up to about 8 seconds, and `runner stage` reads the issue's branch with the Stage's own token before `claude` starts, so the Stage's MCP server never gets a blind one.

Linear names an issue's branch after whoever asks: `dkomeza/ban-11-…` for you, `bankirunner/ban-11-…` for the app. The issue's branch is the one on origin with that name under any prefix, so the Runner carries on a branch you started live, and you one it started; when origin has none, the Runner's first push creates `bankirunner/…`. When origin has it under several prefixes, the Dispatcher logs `Couldn't decide on BAN-N` on each tick and a Stage stops on you: delete the ones that aren't the issue's. The worktree is the name without its prefix, whoever started it.

## GitHub: the App

On GitHub the Runner is a private App installed on this repo only. In **Settings → Developer settings → GitHub Apps → New GitHub App**:

1. Name it **Banki runner** (its slug is then `banki-runner`). Any homepage URL will do. Turn **Webhook** off.
2. **Repository permissions.** Read and write: **Contents**, **Pull requests**, **Actions** (to dispatch `slug-preview`). Read-only: **Checks**, **Commit statuses**, **Deployments**, **Metadata**. Nothing else: in particular no **Workflows**, so no push can change `.github/workflows/`, where the Actions secrets are, and no **Administration**.
3. **Where can this GitHub App be installed?** Only on this account.
4. Create it, note its **App ID**, and **generate a private key**, which downloads a `.pem` file. `bootstrap` copies it in; delete the download afterwards.
5. **Install App**, on `dkomeza/banki` only (**Only select repositories**).

The Broker finds the installation itself. Every token it mints is for this repo alone, with the App's permissions, and lasts an hour; it mints a new one when under 15 minutes remain. Stages commit and push as `banki-runner[bot]`, with its noreply email, and `gh` and git ask the Broker for a token on every call, so a Stage outlives any one token.

## GitHub: the merge guard

Whatever reaches `main` runs on the server on the next tick, the pull agent with its Docker socket included, so only you can make the App's pull requests mergeable. The `main` ruleset requires an approving review, dismisses approvals on a new push, and requires the last push to be approved by someone other than its pusher. The App isn't a bypass actor; your own (live-mode) pull requests merge through the existing admin bypass (`RepositoryRole` 5, in pull-request mode). Set it once with the command below. It reads the live ruleset, changes those three settings of its `pull_request` rule and nothing else, and writes it back, so a rule added since this was written is kept; it stops, writing nothing, when the ruleset has no `pull_request` rule. Then it reads the ruleset again:

```sh
ruleset=repos/dkomeza/banki/rulesets/25304272
body="$(gh api "$ruleset" | jq '
  if any(.rules[]; .type == "pull_request") then . else error("the ruleset has no pull_request rule") end
  | {name, target, enforcement, conditions, bypass_actors, rules: [.rules[]
      | if .type == "pull_request"
        then .parameters += {required_approving_review_count: 1, dismiss_stale_reviews_on_push: true, require_last_push_approval: true}
        else . end]}')" &&
  gh api --method PUT "$ruleset" --input - <<<"$body" >/dev/null &&
  gh api "$ruleset" --jq '{bypass_actors, rules: [.rules[].type], pull_request: (.rules[] | select(.type == "pull_request") | .parameters)}'
```

The read-back should show `required_approving_review_count: 1`, `dismiss_stale_reviews_on_push: true` and `require_last_push_approval: true`, the other rules as they were, and the one bypass actor, `RepositoryRole` 5.

## Setting it up

You need Docker with Compose v2 on the home server, and a Claude token made for the Runner alone, so it can be revoked without touching anything else:

```sh
claude setup-token
```

Then, from a checkout of `main` on the server:

```sh
deploy/runner/bootstrap
BANKI_RUNNER_COMMIT="$(git rev-parse HEAD)" docker compose -f deploy/runner/compose.yaml up -d --build
```

`bootstrap` asks for the Claude token, the App's ID and the path to its private key (which it copies in), and the Linear app's client ID and secret; the secrets are read without echo. It writes them to `$BANKI_RUNNER_SECRETS`, by default `~/.config/banki-runner`, outside the clone (a `0700` directory of `0600` files), and refuses a directory inside a git work tree. It also writes your uid and gid, the server's timezone, and that directory's path, to `deploy/runner/.env` (gitignored), which Compose reads: both containers run as you, so they can read your `0600` files with no extra capability, the Dispatcher's window runs on the server's clock (`TZ`, from `TZ`, `timedatectl`, `/etc/timezone` or `/etc/localtime`, in that order), and Compose refuses to start them until `bootstrap` has run. It keeps every other line in that file, so the Dispatcher's settings you put there ([below](#the-window)) survive a re-run. A Runner set up before the Dispatcher came needs `bootstrap` run once more, for the timezone. Run it again to change a value: each one it has is the default, so Enter keeps it. The Broker reads its settings only on start, so afterwards run `docker compose -f deploy/runner/compose.yaml up -d --force-recreate`.

The Broker gets the App's key and the Linear client secret, and the runner the Claude token, as compose secrets: files under `/run/secrets/`, so none is in an environment in `docker inspect`, and each container gets only its own. All three run with a read-only root filesystem, `no-new-privileges`, every capability dropped, and each on its own network with internet access; only the Dashboard publishes a port, on the host's `127.0.0.1` alone. The runner has an 8 GB memory cap, no CPU cap and a 1 GB `/dev/shm` for Chromium; the Broker has 128 MB, and the Dashboard 256 MB.

The runner's volume, `banki-runner-work`, is mounted at `/work`:

| Path                     | What it is                                                                                                                                                |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/work/banki`            | The clone of `main`, and each Stage's working directory                                                                                                   |
| `/work/banki-worktrees/` | The issues' worktrees, as on the laptop                                                                                                                   |
| `/work/logs/`            | Each Stage's logs, kept 30 days                                                                                                                           |
| `/work/dispatcher/`      | The Dispatcher's records: the gate's last reading, the Stages running or paused, the Stages that ended, for their costs, and the tick log (`ticks.jsonl`) |
| `/work/home/`            | HOME: `~/.claude`, bun's cache, and Playwright's browsers (`PLAYWRIGHT_BROWSERS_PATH`)                                                                    |

Chromium isn't in the image: each worktree installs the build its own Playwright wants with `npx playwright install chromium`, a no-op once it is there, so a Playwright bump on `main` needs no rebuild.

## Keeping it off the host and the LAN

A Stage runs branch code with permission prompts skipped, so the runner's network, `10.213.94.0/24` (fixed in `compose.yaml`), reaches the internet and nothing private; and so does the Dashboard's, `10.213.96.0/24`, since it runs from the clone a Stage can write to. Docker can't do that alone: the host's firewall does it, with `deploy/runner/host-firewall`, which drops everything from those subnets

- to the private ranges (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `100.64.0.0/10`, `169.254.0.0/16`), through Docker's `DOCKER-USER` chain: the home LAN, the other Docker networks and the Previews;
- to the host itself, at any of its addresses, through `INPUT`, which `DOCKER-USER` never sees: the home server's ports. Only the replies to connections the host itself started get through, such as `curl http://127.0.0.1:8790/` or Newt reaching the Dashboard; a container can't start one to the host.

Port 53 is let through both, for an upstream resolver on the LAN or on the host: Docker's embedded DNS (`127.0.0.11`) sits in the container's own namespace, but sends the queries it forwards from there too. The networks have no IPv6, so there are no `ip6tables` rules. If another network or your LAN already uses `10.213.94.0/24` or `10.213.96.0/24`, change it in both files (a test checks that they agree).

Install it as a systemd unit, which applies it whenever Docker starts, after a reboot included (iptables rules don't survive a reboot, and Docker keeps whatever is in `DOCKER-USER`):

```sh
sudo install -m 755 deploy/runner/host-firewall /usr/local/sbin/banki-runner-firewall
sudo tee /etc/systemd/system/banki-runner-firewall.service >/dev/null <<'UNIT'
[Unit]
Description=Keep the Banki Runner's network off the host and the LAN
After=docker.service
PartOf=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/local/sbin/banki-runner-firewall

[Install]
WantedBy=docker.service
UNIT
sudo systemctl daemon-reload
sudo systemctl enable --now banki-runner-firewall
```

`PartOf` applies the rules again whenever Docker restarts. After `host-firewall` changes on `main`, run the `install` line again, then `sudo systemctl restart banki-runner-firewall`; running it twice changes nothing. Check the rules with `sudo iptables -S BANKI-RUNNER-FORWARD` and `sudo iptables -S BANKI-RUNNER-INPUT`, and from inside, that the internet is in reach and the LAN isn't:

```sh
docker compose -f deploy/runner/compose.yaml exec runner curl -sS -m 5 https://api.github.com/zen
docker compose -f deploy/runner/compose.yaml exec runner curl -sS -m 5 http://192.168.1.1/ # times out
docker compose -f deploy/runner/compose.yaml exec dashboard curl -sS -m 5 https://api.github.com/zen
docker compose -f deploy/runner/compose.yaml exec dashboard curl -sS -m 5 http://192.168.1.1/ # times out
curl -sS -m 5 http://127.0.0.1:8790/ >/dev/null && echo "the Dashboard answers"
```

## The tick

Every 5 minutes the runner runs `git fetch origin main` and `git reset --hard origin/main` in `/work/banki`, in place, even while a Stage runs there, and then runs `deploy/runner/tick.ts` from the clone, which runs the [Dispatcher](#the-dispatcher). Each sync first makes sure the clone's `origin` is the repo, and removes the locks a git killed mid-write left in the clone's own git dir once they are 10 minutes old (never a worktree's). A failed sync skips the tick, so it never runs on a half-synced clone, and after three in a row the log says plainly that the clone is stuck. A failed tick is logged too, and the loop goes on:

```sh
docker compose -f deploy/runner/compose.yaml logs -f runner
```

The tick and `run-now` also append each line they print to `/work/dispatcher/ticks.jsonl` (`{ "at", "main", "line" }`), which the [Dashboard](#the-dashboard)'s `/ticks` shows; each tick drops its lines older than 30 days.

When anything baked into the image (`deploy/runner/Dockerfile`, `compose.yaml`, `broker/`, `loop/`, `lib/` or `bin/`) changed on `main` since the commit the image was built from, or `main` pins another bun (`packageManager` in `package.json`) or node (`.node-version`) than the image has, the log says so once per `main` commit, with the reason and the command to run by hand from an up-to-date checkout of `main`:

```sh
git pull
BANKI_RUNNER_COMMIT="$(git rev-parse HEAD)" docker compose -f deploy/runner/compose.yaml up -d --build
```

An image built without `BANKI_RUNNER_COMMIT` counts as behind, since nothing says what it holds.

## The Dispatcher

Each tick, the Dispatcher looks at the issues of project Banki and decides each one's next move from its status, its assignee, its closing comments and GitHub, with no LLM ([ADR-0013](../adr/0013-linear-statuses-drive-the-stages-through-a-dispatcher-without-an-llm.md); `docs/agents/issue-tracker.md` § Statuses):

| Status     | Next                                                                                                                                                                                        |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Todo       | The implement Stage                                                                                                                                                                         |
| In Design  | The design Stage, unless a round is built since the issue came in from Backlog or Design Review: then the wait for its Variants' Slug Previews, and the hand-off to Design Review           |
| In Review  | The Acceptance fix, after a move back from Acceptance. The Rebase Stage, when the pull request conflicts with `main`. Otherwise the wait for the PR Preview, and the hand-off to Acceptance |
| Acceptance | Yours, unless the pull request conflicts with `main`: then the Rebase Stage, and the issue stays in Acceptance                                                                              |

It leaves alone any issue that is assigned, and any In Progress issue none of its supervisors started. The waits, the hand-offs and the stops cost no tokens, so they happen on every tick, in or out of the window; a wait that fails, or runs past its deadline (`.claude/skills/work-issue/references/stages.md` § Waits), is a stop on you. A Variant's Slug Preview that fails is first dispatched again, up to twice, and only then a stop; your reply to that stop dispatches the failed ones again and waits for them. A state that fits none of the rows, such as an In Review issue whose pull request is closed, is a stop too, saying what it found. So is a pull request that still conflicts after a Rebase Stage, while `main` hasn't moved since ([ADR-0035](../adr/0035-the-runner-rebases-a-pull-request-that-conflicts-with-main.md)).

Ready Stages start closest to Done first (Acceptance, In Review, then Todo, then In Design), then by Linear priority, then oldest. Each one runs under a **supervisor**, a detached `runner supervise`, which outlives the tick: it takes the gate's reading, looks at the issue again (and starts nothing if it was assigned or moved since the tick looked), sets it In Progress, runs the Stage as `runner stage` does for at most 3 hours of running time (SIGTERM to `claude` and everything it started, then SIGKILL a minute later), takes the reading again, and posts the Stage's closing comment and sets the next status from its result. At most `BANKI_RUNNER_MAX_STAGES` (2) run at once, paused ones included, and never two on one issue.

- **A crash or a timeout.** A supervisor that is gone while its issue is In Progress, or a Stage that ran out of time or left no result, puts back the status from before In Progress, posts a stop comment with the last 30 lines of its log (one per event, never the raw JSON), and assigns you.
- **The five-hour limit.** A Stage it cuts short is paused, not failed: its issue stays In Progress, unassigned, and the Stage goes on in its own `claude` session, its worktree as it left it, at the first tick in the window after that window starts over, ahead of the queue and still behind the gate. A paused Stage holds its place under the cap.

Each tick also deletes Stage logs older than 30 days, takes down a canceled issue's Variant Slug Previews, and removes the worktrees of Done or Canceled issues, Variants' included, once they are clean and every commit is on origin.

## The window

Stages start only inside the window, in server time:

| Variable                  | Default       | What it is                                                          |
| ------------------------- | ------------- | ------------------------------------------------------------------- |
| `BANKI_RUNNER_NIGHT`      | `01:00-07:00` | Every night, `HH:MM-HH:MM`; it may cross midnight                   |
| `BANKI_RUNNER_OPEN_DAYS`  | `sat,sun`     | Days open all day, and on into the night after them; empty for none |
| `BANKI_RUNNER_MAX_STAGES` | `2`           | How many Stages may run or wait paused at once                      |

An open day runs until the night after it ends, so with the defaults Saturday 00:00 to Monday 07:00 is one stretch. A Stage that is running finishes past the window. Set any of them, or the Ceiling's, in `deploy/runner/.env`, then `docker compose -f deploy/runner/compose.yaml up -d`.

## The Ceiling

Before it starts or resumes a Stage, the gate reads how much of each usage window is used, from the `rate_limit_event` of a one-line Haiku call with the Runner's Claude token. A Stage starts only if the week's utilization, plus the estimates of the Stages running, plus its own, stays within the [Ceiling](../../CONTEXT.md), and the five-hour window is under 80%. If the next Stage doesn't fit, a cheaper ready one may still start. A reading that fails starts nothing.

| Variable               | Default | What it is                                                 |
| ---------------------- | ------- | ---------------------------------------------------------- |
| `BANKI_RUNNER_CEILING` | `0.60`  | The share of the weekly window above which no Stage starts |

Your own use counts toward it, so whatever is above the Ceiling stays yours. A Stage's cost is how far the week moved between the readings before and after it, your use while it ran included; Stages that overlapped split their move by each one's dollar cost. A Stage with any run whose reading is missing has no known cost. Each kind of Stage is estimated at the median of its known costs, and at 5% until it has three.

## `runner status` and `runner run-now`

```sh
docker compose -f deploy/runner/compose.yaml exec runner runner status
docker compose -f deploy/runner/compose.yaml exec runner runner run-now BAN-N [--force]
```

`status` shows the Stages running and paused, the ready queue in order with why each one would or wouldn't start now, what the Dispatcher is waiting on, the gate's last reading and the estimates, the recent Stages with their costs, and the In Progress issues none of its supervisors started. It takes no reading and changes nothing.

`run-now` starts the issue's next Stage now, or resumes its paused one, even outside the window. It still keeps the cap, the five-hour check and the rule that skips an issue that is assigned or running; `--force` skips the Ceiling, and only that. It prints the Stage's log, or why nothing starts.

## The Dashboard

The [Dashboard](../../CONTEXT.md) shows what the Runner and the Dispatcher are doing, and what each issue went through, in one place, without ssh ([ADR-0015](../adr/0015-the-dashboard-reads-through-the-broker-from-a-container-of-its-own.md)). It is the `dashboard` service, at `runner.banki.dkomeza.com` behind Pangolin's SSO:

| Page                        | What it shows                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`, Now                    | What `runner status` shows, live, from the same view: the Stages running (for how long, their cost so far in dollars, their logs) and paused, the ready queue with why each would or wouldn't start, each wait with its deadline, how far along it is and its deployments' states, the gate's last reading against the Ceiling, and the In Progress issues no supervisor started |
| `/issues/BAN-N`             | The issue's timeline, oldest first: every attempt at a Stage (its outcome, a one-line reason, its cost and duration, its runs' logs), its closing comments (a Stage run live is marked live, a stop shows its question) and its moves in Linear. A run whose log has no `claude` init event **never started**, which is told apart from a crash                                  |
| `/issues/BAN-N/logs/<file>` | One Stage log, as the one-line summaries `runner stage` prints, never the raw JSON (its last 2000 lines at most, saying how many MB before them it leaves out), then the Stage's result. A running Stage's log streams as it grows. Only files under `/work/logs/BAN-N/` are served                                                                                              |
| `/ticks`                    | The tick log, newest first, with consecutive identical lines collapsed (`Tick on main abc1234 ×60`)                                                                                                                                                                                                                                                                              |

It also flags the pull agent's health, from GitHub alone: a `preview` or `slug-preview` deployment still `queued`, or with no status, 10 minutes after it was made says "the pull agent hasn't claimed it for N min", on the Now page and in the wait that waits on it.

The Now page's live view is computed when someone asks for it, at most once every 30 seconds whoever is watching, with one Linear token from the Broker, revoked after it; GitHub tokens come from the Broker as they do for the tick. Every page renders in full without JavaScript; with it, the Now page takes the live view every 30 seconds and a running Stage's log its new lines, over SSE.

It is **read-only**: it serves `GET` alone (anything else answers 405), makes no write to Linear or GitHub, mounts the volume read-only, and holds no secret, not even the Claude token, so there is no `run-now` and no usage reading there. Everything it shows from a log or a comment is escaped, and redacted of anything shaped like a GitHub, Linear or Claude token, under a CSP that allows no inline script or style and nothing from another origin.

It runs `deploy/runner/dashboard/` from the clone of `main` (through `dashboard` on PATH), and exits once the clone's `HEAD` moves, so Docker starts it again on the new `main`: a change to it needs no rebuild. It listens on `127.0.0.1:8790` on the host, and nowhere else:

```sh
docker compose -f deploy/runner/compose.yaml logs -f dashboard
curl -sS http://127.0.0.1:8790/ticks
```

Pangolin's SSO is its only auth: it trusts whatever reaches that port. Make its Pangolin resource by hand, once, in Pangolin's dashboard:

1. **Resources → Add Resource**: an HTTP resource named `Banki Runner`, on the **homelab** site (the Newt that runs as a host process on the home server), never the Previews' site: the target is the host's own `localhost`.
2. **Domain**: subdomain `runner` of `banki.dkomeza.com`. `runner` is a reserved Slug, so no Slug Preview can take it.
3. **Target**: `http`, `localhost`, port `8790`.
4. **Authentication**: turn on **Use Platform SSO**, and allow only your own user, not a role others hold.

Then open `https://runner.banki.dkomeza.com/`: Pangolin asks you to sign in first. To look at the pages without the home server, `bun deploy/runner/dashboard/fixture.ts` serves them on `127.0.0.1:8790` over a made-up Runner, with Linear and GitHub faked.

## When a Stage stops on you

A stop is a closing comment on the issue that asks you something, with the options it sees, the recommended one first, and the issue assigned to you. Answer it **in that comment's thread**: your reply hands the issue back, and on the next tick the Dispatcher unassigns it and runs that Stage again, which takes your reply as the answer. A stop from a wait that failed starts the wait over instead, counting its deadline from your reply. A top-level comment never hands an issue back. To take the issue yourself, run it live with `/work-issue BAN-N`, which keeps it assigned.

In Design Review and Acceptance a comment alone starts nothing: moving the issue back does, and the next Stage reads every comment of yours since the hand-off.

## Running one Stage by hand

```sh
docker compose -f deploy/runner/compose.yaml exec runner runner stage <design|implement|acceptance-fix|rebase> BAN-N
```

It runs the Stage's prompt (`.claude/skills/work-issue/stages/<kind>.md`) on the issue, headless, in the clone of `main`, as a Dispatcher-started one would. It gets a Linear token from the Broker for this Stage alone and gives `claude` a per-run MCP config (`0600`, deleted afterwards) whose one server is `linear-banki`, then runs `claude -p --output-format stream-json --verbose --dangerously-skip-permissions --strict-mcp-config --mcp-config <file> --add-dir /work/banki-worktrees` with the Claude token and no `ANTHROPIC_API_KEY`. It runs in the foreground and prints one line per event, prints the Stage's result (`<wt>/.ui/stage-result.json`) at the end, and revokes the Linear token whatever happens, Ctrl-C included. It never changes the issue's status or assignee, and posts no closing comment: that is the Dispatcher's job, so prefer `run-now`. `exec -d` instead of `exec` runs it detached.

## Reading a Stage's log

Every event of a Stage is kept in `/work/logs/BAN-N/<start time>-<kind>.jsonl`, one JSON object per line: `claude`'s stream-json events, and `runner` events for its start, its stderr, its time limit and its exit. A Stage the Dispatcher started has its supervisor's lines beside it, in `<start time>-<kind>.log`: one per event, as `runner stage` prints them, and what the supervisor did. A paused Stage has a pair for each run. Each tick deletes the logs older than 30 days.

```sh
docker compose -f deploy/runner/compose.yaml exec runner ls /work/logs/BAN-94
docker compose -f deploy/runner/compose.yaml exec runner tail -f /work/logs/BAN-94/2026-10-24T01-00-00Z-implement.log
docker compose -f deploy/runner/compose.yaml exec runner tail -f /work/logs/BAN-94/2026-10-24T01-00-00Z-implement.jsonl
docker compose -f deploy/runner/compose.yaml exec runner sh -c 'grep "\"type\":\"result\"" /work/logs/BAN-94/*.jsonl'
```

The Broker logs every token it mints or revokes, by ID, never the token itself:

```sh
docker compose -f deploy/runner/compose.yaml logs broker
```
