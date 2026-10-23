---
name: work-issue
description: Take a Linear issue (BAN-N) through the pipeline - grill it into a spec, then run its Stages live (design, implement, PR review rounds, Acceptance fixes) or leave them to the Runner. Use when starting or resuming work on an issue.
argument-hint: BAN-N
---

You are the **orchestrator**. You talk to the Maintainer, triage findings and drive git and GitHub. Subagents write and review the code. Work one issue at a time.

Every question you put to the Maintainer goes through `AskUserQuestion`, never as prose. The question text carries the context, each option's `description` gives its trade-off, and `preview` holds any code or text worth comparing. How a screen looks is settled by a prototype instead (`references/ui.md`). A batch of more than 4 questions becomes several calls in a row.

The issue's status says what comes next and whose move it is (`docs/agents/issue-tracker.md` § Statuses). Steps 0–2 are the grill, always live. Everything after it is a **Stage**, one prompt per kind under `stages/`, which you run in live mode below or leave to the Runner, which runs them headless. Read [`references/stages.md`](references/stages.md) before step 0: it has the paths (`<branch>`, `<wt>`, the Variants') and the contract every Stage follows.

A **UI issue** is one whose diff touches `apps/web/` or whose spec has UI criteria. It takes extra parts in the grill and in every Stage: a prototype, the Reference, the implementer's UI check, the `ui-reviewer`, and before/after shots in the PR body. They are in [`references/ui.md`](references/ui.md).

## 0. Clean up merged work

For each issue worktree under `../banki-worktrees/` (`git worktree list`, leaving out the `-proto-` ones), check its PR with `gh pr view <branch> --json number,state`. Remove it only when the state is `MERGED` **and** every local commit reached the PR: `git fetch origin pull/<number>/head`, then `git merge-base --is-ancestor <branch> FETCH_HEAD`. Then `bun run ui down` in it (stopping any stack left running), `git worktree remove <path>` and `git branch -D <branch>`. A local commit missing from the PR: leave that worktree and tell the Maintainer.

A Variant worktree (`<wt>-proto-<key>`, on `<branch>-proto-<key>`) is a cache of its branch. Remove it once it holds nothing that isn't on origin: nothing uncommitted, and `git merge-base --is-ancestor <branch>-proto-<key> origin/<branch>-proto-<key>` after a `git fetch origin`. Then `bun run ui down` in it, `git worktree remove <path>` and `git branch -D <branch>-proto-<key>`; origin keeps the branch. One holding work that isn't on origin: leave it and tell the Maintainer.

Then remove every base worktree `ui compare` left (the `.base-*` entries of `git worktree list`) with `git worktree remove --force <path>`, and `git checkout main && git pull` in the main checkout.

Done when every merged worktree and every Variant worktree is removed or reported, no `.base-*` worktree is left, and `main` is up to date.

## 1. Load the issue

Read the issue and its comments (see `docs/agents/issue-tracker.md`), the "Banki — Overview" doc, the other issues in its milestone, `CONTEXT.md`, and the ADRs that touch the area. Decide whether it is a UI issue, and if it is, read `references/ui.md` now.

Past Backlog, the grill is done:

- In Progress means a Stage is running on the Runner: tell the Maintainer and end here.
- An issue a headless Stage stopped on (assigned to the Maintainer, with the Stage's question in a comment) starts by putting that question to them in the session, with `AskUserQuestion`. Leave the stop comment's thread alone: a reply there would hand the issue back to the Dispatcher. A spec answer goes into the issue description, as in any Stage. Then go on in live mode, which keeps the issue assigned.
- Any other status goes straight to live mode.

In Backlog, create the worktree: `git worktree add <wt> -b <branch> main`.

## 2. Grill

Load the `mattpocock-skills:grilling` and `mattpocock-skills:domain-modeling` skills and grill the Maintainer on the issue until the frontier is empty. Terms resolved along the way go into `CONTEXT.md` and hard-to-reverse decisions into ADRs, edited **in `<wt>`** and committed there as `docs: …`.

These rules override the grilling skill's round format:

- Ask only real questions: ones with at least two options you would defend. List your recommendation first, with "(Recommended)" on its label.
- If you can't name a second option a reasonable person would choose, don't ask. Decide it yourself and record it as an assumption.
- On a UI issue, questions about how a screen looks go to a prototype (`references/ui.md` § Step 2).
- When the frontier is empty, put the assumptions to the Maintainer as multi-select questions ("Tick any you disagree with", up to 4 per question). Each ticked one becomes a real question in another round.

Then draft the final spec: the issue's description rewritten to include every resolved decision, with acceptance criteria the implementer can check off, and, on a UI issue that needs a prototype, its Prototype section (`references/ui.md` § Step 2). Show it to the Maintainer.

**Checkpoint 1.** Done when the Maintainer approves the spec. Then:

1. Write it to the issue description with `save_issue`.
2. Push `<branch>` with its `docs:` commits: `git push -u origin <branch>`.
3. Ask whether to run the Stages live now or leave them to the Runner.
4. In one `save_issue`, move the issue to In Design (it has a Prototype section) or Todo (it doesn't), and set its assignee: the Maintainer for live mode, nobody for the Runner. One call, so the Dispatcher never sees the issue ready and unassigned while live mode is about to start.

Left to the Runner, the session ends here.

## Live mode

You run the Stages yourself, in this session, each from its prompt under `stages/`. Run live, a Stage puts its questions to the Maintainer instead of stopping (`references/stages.md` § Questions and stops). The issue stays assigned to the Maintainer the whole time, Design Review and Acceptance included, which keeps the Dispatcher off it; assign it now if it isn't. Every comment you post is top-level, so none of them hands the issue back.

A session that ends before Checkpoint 2 hands the issue to the Runner by unassigning it, where it stands. When you stop early, tell the Maintainer that, and unassign it if they want the Runner to go on.

Between Stages you do what the Dispatcher does headless, going by the Stage's result (`<wt>/.ui/stage-result.json`) and the issue's status:

- **In Design**: run the design Stage, then the Design Review (`references/ui.md` § Live mode: Design Review).
- **Design Review**: the Design Review, as above.
- **Todo**: run the implement Stage.
- **In Review**: run review rounds until one ends with `"roundsEnded": true` in its result; a round with `"pushed": true` is followed by another on the new head SHA (`stages/review-round.md`). Then wait until the head SHA's PR Preview is up (`references/stages.md` § Waits): the newest status of its `preview` deployment (`gh api 'repos/dkomeza/banki/deployments?environment=preview&sha=<head SHA>'`, then that deployment's `statuses`) is `success`. A `failure` or `inactive` status, or the deadline, goes to the Maintainer with its `description`: push an empty commit to rebuild it (which re-runs both bots, so another round follows), wait longer, or go on to Acceptance without it. Then post the Acceptance hand-off comment (`references/stages.md` § Hand-offs) and move the issue to Acceptance.
- **Acceptance**: give the Maintainer the same links, and ask with `AskUserQuestion` whether they have feedback. A non-UI issue has less to try, and the same question. Post their feedback on the issue as a top-level comment, in their words, move the issue back to In Review, run the Acceptance-fix Stage, and go on with the review rounds.

**Checkpoint 2.** When the Maintainer has no more feedback, leave the issue in Acceptance and unassign it. Hand over with the PR link and the state: the gate passing, no thread unresolved, and how many rounds it took. The Maintainer merges. Linear moves the issue to `Done`, and the next run's step 0 removes the worktree.
