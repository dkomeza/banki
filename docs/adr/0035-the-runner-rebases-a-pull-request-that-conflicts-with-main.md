# The Runner rebases a pull request that conflicts with main

This amends ADR-0013 and ADR-0027. The Dispatcher watches the pull request of every issue In Review or in Acceptance, and when GitHub says it can't merge into `main`, it runs a Rebase Stage: rebase onto `origin/main`, never a merge, resolve each conflict so both sides survive, run the root checks, and force-push with lease. The Stage leaves the issue where it ran, which the Dispatcher reads from the issue's history, not from the result. A move back from Acceptance still goes to the Acceptance fix first, which rebases on its own. When the newest Rebase Stage ended on the same head SHA, and `main` hasn't moved since, the Dispatcher stops on the Maintainer instead of running it again.

GitHub builds no PR Preview of a conflicting pull request. Without this, an issue In Review waited on a Preview that would never come. A reply to that stop only restarted the wait, so the issue stopped again on the next tick. BAN-35 went round that loop three times after `main` took the migration number its pull request used.

## Considered Options

- **The Maintainer rebases, and the stop says so**: what there was. It is the step they hand the Runner Stages to avoid, and every merge to `main` can set it off again on every open pull request.
- **Move the issue back to In Review and reuse the Acceptance fix**: no new Stage, but a move back from Acceptance is how the Maintainer says they have feedback, and there would be none to read.
- **Leave issues in Acceptance alone**: the Maintainer is trying the PR Preview there, and a rebase builds it again under them. But they can't merge until it's rebased, and the new Preview has the same link.

## Consequences

- In Acceptance, the Rebase Stage sends the issue In Progress and back. A move into Acceptance from In Progress is no hand-off: it neither ends the comments since the hand-off nor counts as the hand-off of a head SHA.
- Each tick reads a single pull request (and, when it conflicts, `main`'s tip) for every issue In Review or in Acceptance.
- An issue that a stop holds isn't rebased until the Maintainer replies. A reply to a PR Preview stop restarts the wait, which finds the conflict and rebases.
