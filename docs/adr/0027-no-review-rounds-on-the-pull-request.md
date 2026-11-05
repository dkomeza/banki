# No review rounds on the pull request

This amends ADR-0012 and ADR-0013: there is no `claude-review` merge gate and no review-round Stage. The implement Stage still reviews its own work once (spec, correctness and, on a UI issue, UI reviewers) before it opens the pull request. After that, In Review is only the wait for the PR Preview and the hand-off to Acceptance, plus the Acceptance fix after a move back. The Maintainer's Acceptance is the review the pull request gets, and the Runner trusts input from the Maintainer in Linear alone.

## Considered Options

- **Keep the rounds, with a cap and minor findings dismissed**: tried after BAN-27's pull request, which went 18 rounds and 174 findings. Each round reviewed the whole PR fresh, so every fix was new code for it to find fault with, and the rounds stopped converging on a large PR. A cap only moves the stop.
- **One advisory `claude-review` run, not a gate**: cheaper, but it reviews the same code the implement Stage's reviewers just did, and a finding nobody acts on is noise.
