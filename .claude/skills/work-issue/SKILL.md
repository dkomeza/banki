---
name: work-issue
description: Take a Linear issue (BAN-N) from spec to an open PR - grill, implement in a worktree, adversarial review, the PR review gate. Use when starting work on an issue.
argument-hint: BAN-N
---

You are the **orchestrator**. You talk to the user, triage findings and drive git and GitHub. Subagents write and review the code. Work one issue at a time.

Every question you put to the user goes through `AskUserQuestion`, never as prose. The question text carries the context, each option's `description` gives its trade-off, and `preview` holds any code or text worth comparing. How a screen looks is settled by a prototype instead (`references/ui.md`). A batch of more than 4 questions becomes several calls in a row.

Paths used below:

- `<branch>`: the issue's `gitBranchName` from Linear (e.g. `dkomeza/ban-74-walking-skeleton-…`).
- `<wt>`: the worktree, `../banki-worktrees/<branch without the "dkomeza/" prefix>`, as an absolute path.

A **UI issue** is one whose diff touches `apps/web/` or whose spec has UI criteria. It takes extra parts at steps 2, 3, 4, 5, 7 and 8: a prototype, the implementer's UI check, the `ui-reviewer`, and before/after shots in the PR body. They are in [`references/ui.md`](references/ui.md), by step.

## 0. Clean up merged work

For each issue worktree under `../banki-worktrees/` (`git worktree list`, leaving out the `-prototype` ones), check its PR with `gh pr view <branch> --json state,headRefOid`. Remove it only when the state is `MERGED` **and** the local branch tip (`git rev-parse <branch>`) equals `headRefOid`: `bun run ui down` in it (stopping any stack left running), then `git worktree remove <path>` and `git branch -D <branch>`. A tip that differs means local commits that never reached the PR: leave that worktree and tell the user.

A prototype worktree (`<wt>-prototype`, on `<branch>-prototype`) is left over when a session ended before step 2 captured it. Clean it up once its issue worktree is gone, whether removed just now or earlier: `bun run ui down` in it, commit anything uncommitted, and `git push -u origin <branch>-prototype`, so no variant is lost. Then `git worktree remove <path>` and `git branch -D <branch>-prototype`; origin keeps the branch. While its issue worktree is still there, leave it: that issue's grill may resume with it.

Then remove every base worktree `ui compare` left (the `.base-*` entries of `git worktree list`) with `git worktree remove --force <path>`, and `git checkout main && git pull` in the main checkout.

Done when every merged worktree is removed or reported, every prototype worktree without its issue worktree is pushed and removed, no `.base-*` worktree is left, and `main` is up to date.

## 1. Load the issue

Read the issue and its comments (see `docs/agents/issue-tracker.md`), the "Banki — Overview" doc, the other issues in its milestone, `CONTEXT.md`, and the ADRs that touch the area. Set the issue to `In Progress`. Create the worktree: `git worktree add <wt> -b <branch> main`.

Decide whether it is a UI issue, and if it is, read `references/ui.md` now.

## 2. Grill

Load the `mattpocock-skills:grilling` and `mattpocock-skills:domain-modeling` skills and grill the user on the issue until the frontier is empty. Terms resolved along the way go into `CONTEXT.md` and hard-to-reverse decisions into ADRs, edited **in `<wt>`** and committed there as `docs: …`.

These rules override the grilling skill's round format:

- Ask only real questions: ones with at least two options you would defend. List your recommendation first, with "(Recommended)" on its label.
- If you can't name a second option a reasonable person would choose, don't ask. Decide it yourself and record it as an assumption.
- On a UI issue, questions about how a screen looks go to a prototype (`references/ui.md` § Step 2).
- When the frontier is empty, put the assumptions to the user as multi-select questions ("Tick any you disagree with", up to 4 per question). Each ticked one becomes a real question in another round.

Then draft the final spec: the issue's description rewritten to include every resolved decision, with acceptance criteria the implementer can check off. Show it to the user.

**Checkpoint 1.** Done when the user approves the spec. Then write it to the issue description with `save_issue`.

## 3. Implement

Spawn the `implementer` agent. Its prompt carries `<wt>` and the approved spec verbatim, plus the UI parts on a UI issue (`references/ui.md` § Step 3). Keep its agent ID: you resume it in steps 6 and 8.

Done when it reports typecheck, lint, format and test green, with its work committed in `<wt>`. Verify that yourself in `<wt>` before moving on, then run `bun run ui down` in `<wt>`.

## 4. Review

Spawn `spec-reviewer` and `correctness-reviewer` in parallel (one message, two Agent calls), and on a UI issue `ui-reviewer` with them (three calls; `references/ui.md` § Step 4). Each prompt carries `<wt>`, the base `main`, and the approved spec. Give them nothing from the implementer, including its screenshots: its summary frames the code the way its author sees it, and the reviews must stay independent of that.

Done when all of them have reported. Then run `bun run ui down` in `<wt>`.

## 5. Triage

Give every finding from the reviews a verdict by reading the code it points at (for a UI finding, `references/ui.md` § Step 5):

- **Confirmed**: the failure scenario really happens. It goes to the fix list.
- **Dismissed**: the scenario cannot happen, is out of the spec's scope, or is taste. Record it with a one-line reason for the PR's Review notes.
- **Spec question**: the spec doesn't say what should happen. Ask the user, and update the issue description with the answer.

Done when every finding has a verdict.

## 6. Fix

Resume the implementer (SendMessage to its ID) with the confirmed findings and any spec answers. If it is gone (e.g. a new session), spawn a fresh `implementer` with the spec plus the findings. Same done-criterion as step 3, including `bun run ui down` in `<wt>` afterwards. There is no second agent review round: CodeRabbit is the next one.

## 7. Open the PR

Push with `git push -u origin <branch>`. Write the body with the `pr` skill, then append:

```markdown
## Review notes

- <dismissed finding> - <one-line reason>
```

(or "None dismissed."). Write the body to `<wt>/.ui/pr-body.md` (gitignored). Title: a conventional commit with the issue ID, e.g. `feat: walking skeleton with typed health check (BAN-74)`; it becomes the squash commit.

On a UI issue, add the before/after shots now (`references/ui.md` § Step 7).

Open the PR from `<wt>` with `gh pr create --base main --head <branch> --title <title> --body-file .ui/pr-body.md`, plus the shots' `--attach` flags on a UI issue. The branch name links the PR to Linear.

## 8. PR review

Every push to the PR is reviewed by two bots:

- **Claude review** (the merge gate): the `claude-review` check (`.github/workflows/claude-review.yml`). It reviews the whole PR fresh at the head commit, posts inline comments for new findings, and keeps one summary comment (marked `<!-- claude-review -->`) listing every finding as `new`, `open` or `fixed`. The check fails while a blocker or major finding is open.
- **Codex** (advisory): inline comments only.

Run at most **2 rounds**. Each round:

1. Wait with a background `until` loop until the `claude-review` check has finished on the PR's head SHA (`gh pr checks <n>`), and Codex has reviewed it (a review from `chatgpt-codex-connector[bot]` whose `commit_id` is the head SHA, or its 👍 reaction on the PR).
2. Triage the `new` and `open` findings from the summary comment, and Codex's new inline comments, as in step 5. Spec questions go to the user.
3. Resume the implementer with the confirmed ones, verify green, and push **once**: every push re-runs both reviews. When the round's fixes touched `apps/web/`, refresh the shots (`references/ui.md` § Step 8).
4. Reply in the thread of each dismissed finding with the reason. The gate weighs replies as arguments on its next run, but only the user can override it.

The round loop ends when `claude-review` passes and Codex has nothing new worth fixing.

**Checkpoint 2.** Hand over to the user with the PR link and the state: gate passing, or what's still open after 2 rounds (a dismissed blocker the gate won't accept needs the user's admin bypass). The user merges. Linear moves the issue to `Done`, and the next run's step 0 removes the worktree.
