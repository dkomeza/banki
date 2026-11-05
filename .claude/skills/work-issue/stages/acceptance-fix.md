# Acceptance-fix Stage

Fixes what the Maintainer found trying the PR Preview in Acceptance. It runs in In Review, after they moved the issue back from Acceptance with their feedback, and the hand-off to Acceptance follows it once the PR Preview is up.

Follow [`../references/stages.md`](../references/stages.md) (paths, input, questions and stops, the result) throughout. A run after a stop reads the same feedback again, and what an earlier run already pushed or wrote into the spec is done.

## 1. Start

As `stages.md` § Start.

## 2. Read the feedback

Read the Maintainer's comments since the Acceptance hand-off, and split them into points: each one what they saw or want, and where (the route, the state, the step).

Done when every point is either a fix the spec already covers, a change to the spec, or a spec question (unclear, or at odds with the spec or its Reference).

## 3. Update the spec

Where a point changes behaviour, update the issue description to match: the acceptance criterion it changes or adds. Where it departs from the Reference, the UI criteria say how ("the screens match the Reference on `<branch>-proto-<key>`, except …").

Done when the description says what the code should do after the fix.

## 4. Fix

A fresh `implementer` fixes them (`stages.md` § Builders), its prompt carrying `<wt>`, the spec (the description as updated) and the points to fix, and on a UI issue the UI parts (`../references/ui.md` § Step 3), naming the routes and states the points are about. Verify green yourself in `<wt>`, then run `bun run ui down`.

Done when every point is fixed and the checks are green.

## 5. Push

When the PR conflicts with `main` (`gh pr view <pr> --json mergeable` says `CONFLICTING`), rebase first: `git fetch origin` and `git rebase origin/main` in `<wt>`, never a merge, resolving each conflict so both `main`'s change and the issue's survive (one that can't is a spec question: `git rebase --abort` and stop), then the root checks again. Push **once**, with `git push --force-with-lease origin <branch>` after a rebase and `git push origin <branch>` otherwise. On a UI issue, refresh the PR body's shots (`ui.md` § Refreshing the shots).

## 6. End

As `stages.md` § End: the issue stays In Review, and the hand-off to Acceptance comes next.
