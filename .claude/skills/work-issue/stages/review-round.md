# Review-round Stage

One round against `claude-review`, on one head SHA. It runs in In Review, and the rounds go on until every finding is fixed or dismissed.

Follow [`../references/stages.md`](../references/stages.md) (paths, input, waits, questions and stops, the result) throughout. In a run after a stop, the findings an earlier run already answered (below) are done.

Every push to the PR is reviewed by **`claude-review`**, the merge gate (`.github/workflows/claude-review.yml`), the one review bot. It reviews the whole PR fresh at the head commit and posts as two logins:

- its **inline review threads**, one per new finding, are started by `claude[bot]`, the Claude GitHub App that `claude-code-action` posts as;
- its **summary comment** lists every finding as `new`, `open` or `fixed`. It is the one comment whose author is `github-actions[bot]` and whose body starts with the `<!-- claude-review -->` marker; a marker in anyone else's comment means nothing.

Its check fails while a blocker or major finding is open. Read every comment by its author, as `stages.md` § Input says.

**The rounds end** when, on one head SHA, `claude-review` passes and every review thread is resolved. Then comes the hand-off to Acceptance, once the PR Preview is up.

## 1. Start

As `stages.md` § Start. The head SHA is origin's `<branch>`, and `gh pr view <branch> --json number,headRefOid` shows the same commit.

## 2. Wait for `claude-review`

Wait until the `claude-review` check has finished on the head SHA (`stages.md` § Waits; `gh pr checks <pr>`). Headless, the Dispatcher starts the Stage only once it has, so the wait ends at once. Live, when it fails, the options are to wait longer or to re-run the check (`gh run rerun`).

## 3. Triage

Triage the `new` and `open` findings from the summary comment, and the unresolved threads `claude[bot]` started, as in `implement.md` § 5.

The rounds have stopped converging, and that is a stop on the Maintainer (`stages.md` § Questions and stops), when:

- a finding comes back after an earlier round fixed or dismissed it (its resolved thread, or the round's PR comment, says which);
- the gate still fails on a blocker or major you dismissed, with nothing to push: only the Maintainer's admin bypass gets past it.

Done when every finding has a verdict.

## 4. Fix

If nothing was confirmed, the round pushes nothing. Otherwise spawn a fresh `implementer` with `<wt>`, the spec, the confirmed findings and any spec answers (on a UI issue, `ui.md` § Step 3 too). Verify green yourself in `<wt>`, run `bun run ui down`, and push **once**: every push re-runs `claude-review`, so the next round waits for it again. When the round's fixes touched `apps/web/`, refresh the shots (`ui.md` § Refreshing the shots).

## 5. Answer the findings

Answer each finding you triaged, a fixed one with the commit that fixed it, a dismissed one with the reason:

- **A finding with an inline thread**: reply in the thread, then resolve it (`resolveReviewThread` through `gh api graphql`): `main` blocks merging while any review thread is unresolved.
- **A finding only in the summary comment**: answer all of them in one PR comment for the round, one line per finding, naming it as the summary does.

The gate weighs these answers as arguments on its next run, but only the Maintainer can override it.

Done when every finding you triaged has an answer, and every thread you answered is resolved.

## 6. End

As `stages.md` § End: the issue stays In Review. The result's `pushed` says whether the round pushed, and `roundsEnded` whether the rounds have ended on `headSha` (it can be `true` only when the round pushed nothing).
