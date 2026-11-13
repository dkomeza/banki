# Rebase Stage

Rebases the issue's pull request onto `main` once it conflicts with it (ADR-0035). The Dispatcher runs it In Review, where GitHub builds no PR Preview of a conflicting pull request, and in Acceptance, where the Maintainer can't merge one. It leaves the issue where it ran. Only the Runner runs it: live, the Acceptance-fix Stage's § 5 rebases the same way.

Follow [`../references/stages.md`](../references/stages.md) (paths, input, questions and stops, the result) throughout. It changes nothing the spec asks for: only what keeping both `main`'s change and the issue's takes.

## 1. Start

As `stages.md` § Start. Take `<pr>` from `gh pr view <branch> --json number`.

## 2. Rebase

`git fetch origin`. When `git merge-base --is-ancestor origin/main HEAD` succeeds, the branch has `main` already: nothing to do, so go to step 5, not pushed.

Otherwise `git rebase origin/main` in `<wt>`, never a merge. Resolve each conflict so both `main`'s change and the issue's survive: read what `main`'s commits changed in the file and why (`git log -p HEAD..origin/main -- <file>` before the rebase starts, or `git log -p ORIG_HEAD..origin/main -- <file>` during it) before you choose.

- **Migrations** (`apps/api/drizzle/`): when `main` took the number of the issue's migration, the issue's goes after `main`'s. Take `main`'s `meta/_journal.json` and snapshots, drop the issue's SQL file and its snapshot, and generate it again on top of `main`'s schema with `bun run db:generate --name <its name without the number>` in `apps/api`. The new SQL does what the old one did, less what `main` already did.
- **Two changes that contradict** (each needs the code to do something the other rules out) is a spec question: `git rebase --abort`, and stop.

Done when the rebase has finished and `git status --porcelain` prints nothing.

## 3. Check

Run the root checks (typecheck, lint, format, test) in `<wt>`. A failure the rebase caused (`main` renamed or changed what the issue uses) is fixed in a commit of its own, `fix: <what>, after rebasing on main (BAN-<n>)`. One that needs a spec decision is a stop.

Done when the checks are green.

## 4. Push

`git push --force-with-lease origin <branch>`, once.

A stop pushes nothing, and throws the rebase away instead of keeping it (`git rebase --abort`, or `git reset --hard origin/<branch>` once it has finished): it is quick to redo, and the run after the reply starts from origin. Its `keptCommits` is `[]`.

## 5. End

As `stages.md` § End. `nextStatus` is the status the issue was in before In Progress, In Review or Acceptance; the Dispatcher reads it from the issue's history either way. The summary names `main`'s changes that conflicted and how each was kept. It also says what comes next:

- **In Review**: the hand-off to Acceptance, once the PR Preview of the new head is up.
- **In Acceptance**: the PR Preview (`https://pr-<pr>.banki.dkomeza.com`) builds again from the new head, and the issue stays in Acceptance.
