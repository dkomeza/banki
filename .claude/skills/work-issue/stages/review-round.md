# Review-round Stage

One round against the PR's review bots, on one head SHA. It runs in In Review, and the rounds go on until every finding is fixed or dismissed.

Follow [`../references/stages.md`](../references/stages.md) (paths, input, questions and stops, the result) throughout. In a run after a stop, the threads an earlier run already replied to and resolved are done.

Every push to the PR is reviewed by two bots:

- **Claude review** (the merge gate): the `claude-review` check (`.github/workflows/claude-review.yml`), posting as `github-actions[bot]`. It reviews the whole PR fresh at the head commit, posts inline comments for new findings, and keeps one summary comment (marked `<!-- claude-review -->`) listing every finding as `new`, `open` or `fixed`. The check fails while a blocker or major finding is open.
- **Codex** (advisory): inline comments only, from `chatgpt-codex-connector[bot]`.

**The rounds end** when, on one head SHA, `claude-review` passes, Codex has reviewed it with nothing new worth fixing, and every review thread is resolved. Then comes the hand-off to Acceptance, once the PR Preview is up.

## 1. Start

As `stages.md` § Start. The head SHA is origin's `<branch>`, and `gh pr view <branch> --json number,headRefOid` shows the same commit; `<pr>` is the PR's number.

## 2. Wait for both bots

Wait with a background `until` loop until **both** bots have reviewed the head SHA: the `claude-review` check has finished on it (`gh pr checks <pr>`), and Codex has reviewed it (a review from `chatgpt-codex-connector[bot]` whose `commit_id` is the head SHA, or a 👍 reaction on the PR made after that push). Never act on one bot alone: Codex often posts a minute or more after the gate. Headless, the Dispatcher starts the Stage only once both have, so the loop ends at once.

## 3. Triage

Triage the `new` and `open` findings from the summary comment, and Codex's inline comments that have no reply yet, as in `implement.md` § 5.

The rounds have stopped converging, and that is a stop on the Maintainer (`stages.md` § Questions and stops), when:

- a finding comes back after an earlier round fixed or dismissed it (its resolved thread says which);
- the gate still fails on a blocker or major you dismissed, with nothing to push: only the Maintainer's admin bypass gets past it.

Done when every finding has a verdict.

## 4. Fix

If nothing was confirmed, the round pushes nothing. Otherwise spawn a fresh `implementer` with `<wt>`, the spec, the confirmed findings and any spec answers (on a UI issue, `ui.md` § Step 3 too). Verify green yourself in `<wt>`, run `bun run ui down`, and push **once**: every push re-runs both reviews, so the next round waits for both again. When the round's fixes touched `apps/web/`, refresh the shots (`ui.md` § Refreshing the shots).

## 5. Reply and resolve

Reply in the thread of each finding you handled: a fixed one with the commit that fixed it, a dismissed one with the reason. Then resolve the thread (`resolveReviewThread` through `gh api graphql`): `main` blocks merging while any review thread is unresolved. The gate weighs replies as arguments on its next run, but only the Maintainer can override it.

Done when every finding you triaged has a reply and a resolved thread.

## 6. End

As `stages.md` § End: the issue stays In Review. The summary says whether the round pushed, and if it didn't, whether the rounds have ended on this head SHA.
