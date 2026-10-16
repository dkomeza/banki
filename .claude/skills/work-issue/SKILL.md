---
name: work-issue
description: Take a Linear issue (BAN-N) from spec to an open PR - grill, implement in a worktree, adversarial review, CodeRabbit. Use when starting work on an issue.
argument-hint: BAN-N
---

You are the **orchestrator**. You talk to the user, triage findings and drive git and GitHub. Subagents write and review the code. Work one issue at a time.

Paths used below:

- `<branch>`: the issue's `gitBranchName` from Linear (e.g. `dkomeza/ban-74-walking-skeleton-…`).
- `<wt>`: the worktree, `../banki-worktrees/<branch without the "dkomeza/" prefix>`, as an absolute path.

## 0. Clean up merged work

For each worktree under `../banki-worktrees/` (`git worktree list`), check its PR with `gh pr view <branch> --json state`. When it is `MERGED`: `git worktree remove <path>` and `git branch -D <branch>`. Then `git checkout main && git pull` in the main checkout.

Done when no worktree with a merged PR is left and `main` is up to date.

## 1. Load the issue

Read the issue and its comments (see `docs/agents/issue-tracker.md`), the "Banki — Overview" doc, the other issues in its milestone, `CONTEXT.md`, and the ADRs that touch the area. Set the issue to `In Progress`. Create the worktree: `git worktree add <wt> -b <branch> main`.

## 2. Grill

Load the `mattpocock-skills:grilling` and `mattpocock-skills:domain-modeling` skills and grill the user on the issue until the frontier is empty. Terms resolved along the way go into `CONTEXT.md` and hard-to-reverse decisions into ADRs, edited **in `<wt>`** and committed there as `docs: …`.

Then draft the final spec: the issue's description rewritten to include every resolved decision, with acceptance criteria the implementer can check off. Show it to the user.

**Checkpoint 1.** Done when the user approves the spec. Then write it to the issue description with `save_issue`.

## 3. Implement

Spawn the `implementer` agent. Its prompt carries `<wt>` and the approved spec verbatim. Keep its agent ID: you resume it in steps 6 and 8.

Done when it reports typecheck, lint, format and test green, with its work committed in `<wt>`. Verify that yourself in `<wt>` before moving on.

## 4. Review

Spawn `spec-reviewer` and `correctness-reviewer` in parallel (one message, two Agent calls). Each prompt carries `<wt>`, the base `main`, and the approved spec. Give them nothing from the implementer: its summary frames the code the way its author sees it, and the reviews must stay independent of that.

## 5. Triage

Give every finding from both reviews a verdict by reading the code it points at:

- **Confirmed**: the failure scenario really happens. It goes to the fix list.
- **Dismissed**: the scenario cannot happen, is out of the spec's scope, or is taste. Record it with a one-line reason for the PR's Review notes.
- **Spec question**: the spec doesn't say what should happen. Ask the user, and update the issue description with the answer.

Done when every finding has a verdict.

## 6. Fix

Resume the implementer (SendMessage to its ID) with the confirmed findings and any spec answers. If it is gone (e.g. a new session), spawn a fresh `implementer` with the spec plus the findings. Same done-criterion as step 3. There is no second agent review round: CodeRabbit is the next one.

## 7. Open the PR

Push `<branch>`. Write the body with the `pr` skill, then append:

```markdown
## Review notes

- <dismissed finding> - <one-line reason>
```

(or "None dismissed."). Title: a conventional commit with the issue ID, e.g. `feat: walking skeleton with typed health check (BAN-74)`; it becomes the squash commit. Open it with `gh pr create --base main`. The branch name links it to Linear.

## 8. CodeRabbit

Run at most **2 rounds**. Each round:

1. Comment `@coderabbitai review` on the PR (the repo has under 10 stars, so reviews only start on request).
2. Wait with Monitor until CodeRabbit has posted a review whose `commit_id` is the PR's head SHA (`gh api repos/{owner}/{repo}/pulls/<n>/reviews`). If its comment says a rate limit was hit, tell the user and stop.
3. Triage its unresolved comments as in step 5. Spec questions go to the user.
4. Resume the implementer with the confirmed ones, verify green, and push **once**: every push dismisses CodeRabbit's approval and costs a review.
5. Reply in the thread of each dismissed comment with the reason, so the user sees it.

The round loop ends when CodeRabbit approves. Your CodeRabbit commands are `review` and `full review`. Overrides (`resolve`, `approve`, `ignore`, `pause`) belong to the user, since they bypass the merge gate.

**Checkpoint 2.** Hand over to the user with the PR link and the state: approved, or what's still open after 2 rounds. The user merges. Linear moves the issue to `Done`, and the next run's step 0 removes the worktree.
