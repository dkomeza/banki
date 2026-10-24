# Implement Stage

Takes an approved spec to an open pull request: the Reference on a UI issue, then the implementer, the reviews, triage, fixes and the PR. It runs in Todo and ends with the issue In Review.

Follow [`../references/stages.md`](../references/stages.md) (paths, input, questions and stops, the result) throughout. On a UI issue, [`../references/ui.md`](../references/ui.md) adds parts to steps 2, 3, 4, 5 and 7.

A run after a stop picks up from origin: a Reference the spec already names is not captured again, step 3's implementer starts from any commits `<branch>` has past the grill's, and an open pull request (`gh pr view <branch>`) is updated, not opened again.

## 1. Start

As `stages.md` § Start.

## 2. The Reference

On a UI issue with a Prototype section whose spec names no Reference yet: read the verdict, capture the Reference and add the UI criteria to the spec (`ui.md` § Implement Stage: the Reference). Otherwise go on to step 3.

## 3. Implement

The `implementer` builds it (`stages.md` § Builders: spawned live, followed yourself headless). Its prompt carries `<wt>` and the spec verbatim (the issue's description), plus the UI parts on a UI issue (`ui.md` § Step 3). Live, keep its agent ID: you resume it in step 6.

Done when typecheck, lint, format and test are green, with the work committed in `<wt>`. Verify that yourself in `<wt>` before moving on, then run `bun run ui down` in `<wt>`.

## 4. Review

Spawn `spec-reviewer` and `correctness-reviewer` in parallel (one message, two Agent calls), and on a UI issue `ui-reviewer` with them (three calls; `ui.md` § Step 4). Each prompt carries `<wt>`, the base `main`, and the spec. Give them nothing from the build, including its screenshots and its report: it frames the code the way its author sees it, and the reviews must stay independent of that.

Done when all of them have reported. Then run `bun run ui down` in `<wt>`.

## 5. Triage

Give every finding from the reviews a verdict by reading the code it points at (for a UI finding, `ui.md` § Step 5):

- **Confirmed**: the failure scenario really happens. It goes to the fix list.
- **Dismissed**: the scenario cannot happen, is out of the spec's scope, or is taste. Record it with a one-line reason for the PR's Review notes.
- **Spec question**: the spec doesn't say what should happen. It goes to the Maintainer (`stages.md` § Questions and stops), and the answer into the issue description.

Done when every finding has a verdict.

## 6. Fix

Fix the confirmed findings and any spec answers as the implementer's § Fixing says. Live, resume the implementer (SendMessage to its ID) with them, or, if it is gone (e.g. a new session), spawn a fresh `implementer` with the spec plus the findings; headless, fix them yourself. Same done-criterion as step 3, including `bun run ui down` in `<wt>` afterwards. The review rounds against the bots are the next review.

## 7. Open the PR

Push with `git push -u origin <branch>`. Write the body with the `pr` skill, then append:

```markdown
## Review notes

- <dismissed finding> - <one-line reason>
```

(or "None dismissed."). Write the body to `<wt>/.ui/pr-body.md` (gitignored). Title: a conventional commit with the issue ID, e.g. `feat: walking skeleton with typed health check (BAN-74)`; it becomes the squash commit.

On a UI issue, add the before/after shots now (`ui.md` § Step 7).

Open the PR from `<wt>` with `gh pr create --base main --head <branch> --title <title> --body-file .ui/pr-body.md`, plus the shots' `--attach` flags on a UI issue. The branch name links the PR to the issue.

## End

As `stages.md` § End: the issue moves to In Review, and the result carries the PR's number.
