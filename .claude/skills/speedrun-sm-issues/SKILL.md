---
name: speedrun-sm-issues
description: Grill several Backlog issues at once - one Opus drafter per issue, only the load-bearing questions put to you, the rest decided as recorded assumptions - and hand them to the Runner.
argument-hint: BAN-N BAN-M …
disable-model-invocation: true
---

You are the **orchestrator** of a batch grill. Each issue in the list gets its own Opus **drafter** subagent, which does the legwork of `work-issue`'s grill (§ 1–2) on its own and comes back with a draft spec and its questions. You put to the Maintainer only the **load-bearing** questions, every issue's at once, and finish every spec without an assumptions round or a spec review: each spec lists its assumptions, and Design Review and Acceptance remain the Maintainer's gates.

Read `.claude/skills/work-issue/SKILL.md` and `references/stages.md` § Paths before step 1; the paths (`<branch>`, `<wt>`) and the statuses are theirs. Every question goes through `AskUserQuestion`, as in `work-issue`.

## 1. Sort the batch

For each issue in the list, read its status and its relations (`get_issue` with `includeRelations`).

- **Skip** any issue past Backlog: its grill is done. Tell the Maintainer which, and that `/work-issue` picks them up.
- A **blocker** is an open `blockedBy` issue. A blocked-by link means the issue's grill needs the blocker's decisions, so:
  - a blocker in the batch puts the issue in a later **wave**, drafted once its blocker's spec is written (step 5);
  - a blocker in Backlog and outside the batch skips the issue: tell the Maintainer which blocker to add;
  - a blocker past Backlog is grilled already and holds nothing up.

Then `git checkout main && git pull` in the main checkout, and create each issue's worktree one after another (parallel `git worktree add` runs fight over git's locks): `git worktree add <wt> -b <branch> main`, or for a `<branch>` already on origin, `git worktree add --track -b <branch> <wt> origin/<branch>`.

Done when every issue is skipped (and said so) or in a wave with its worktree.

## 2. Draft

Spawn one drafter per issue in the current wave, all in one message so they run at once: `Agent` with `subagent_type: general-purpose` and `model: opus`. Each prompt names:

- the issue, `<branch>` and `<wt>` (absolute);
- the brief, [`drafter.md`](drafter.md), which it reads first and follows;
- the rest of the batch, each ID and title, so it keeps to its own issue;
- for a later wave, its blockers in the batch, whose specs are now in their descriptions.

Wait for every drafter's draft report (`drafter.md` § The draft report). Keep each drafter's agent ID: step 4 continues the same agent.

Done when every drafter in the wave has reported.

## 3. Ask

Gather every drafter's questions. Two drafters asking the same question, or deciding one thing two ways (a term, an API shape, a file both will own), become one question for both, naming both issues.

Ask them all, several `AskUserQuestion` calls in a row of up to 4 questions each, every question's text opening with its issue ID (`BAN-49:`) and the context the Maintainer needs to answer without opening the issue. Keep the drafter's recommendation first, with "(Recommended)" on its label.

Never put a drafter's assumptions to the Maintainer: they go into the spec as written.

Done when every load-bearing question has an answer.

## 4. Finish

Send each drafter its answers with `SendMessage` to its agent ID, every answer word for word with its question, and "finish the spec" (`drafter.md` § Finishing). A drafter with no questions gets "no questions: finish the spec".

A drafter whose answers open a new load-bearing question reports it instead of finishing: ask it (step 3) and send the answer back.

Done when every drafter has sent its finished report.

## 5. Hand to the Runner

For each finished issue:

1. Check that its branch is on origin (`git ls-remote --heads origin <branch>`), with the drafter's `docs:` commits.
2. In one `save_issue`: the description set to the finished spec, the status In Design when the spec has a `## Prototype` section and Todo when it doesn't, and no assignee. The Runner takes it from there.

A later wave goes back to step 2 once all of its blockers are written.

Done when every issue in every wave is in In Design or Todo, unassigned, with its branch on origin.

## Hand-over

One line per issue: its ID and title, In Design or Todo, the questions it asked (or "none"), and the number of assumptions its spec records. Then the skipped issues and why.
