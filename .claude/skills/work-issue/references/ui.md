# UI issues

The parts of `work-issue` that only a UI issue takes: in the grill, in each Stage, and in live mode. They use the `ui` script (the README's "Seeing the UI" section), whose stacks and shots live under `.ui/` in each worktree, and Slug Previews (the README's "Slug Previews" section). Paths and Variant keys are as in [`stages.md`](stages.md) § Paths.

## The design baseline

`docs/design.md` is Banki's design language in words: the direction and why, the layout conventions, type, density, how screens use colour. The values stay in `apps/web/src/index.css`; `docs/design.md` says what they are for. Prototypes, the implementer and the `ui-reviewer` all work within it, and changing it is a decision the Maintainer makes, in a grill or in a Design Review verdict.

Until `docs/design.md` exists, the baseline is **provisional**: the "Paper & ink" tokens and the shell BAN-8 shipped were built without a prototype. So the first prototype settles direction as well as structure. One Variant keeps Paper & ink, and the others propose different directions (palette, type, density). The implement Stage then writes `docs/design.md` from the winner.

## Step 2: the Prototype section

A prototype settles how a screen looks, which a question can't: the Maintainer judges each Variant in a browser, on Seed data, at real sizes. The grill asks for one when the issue adds a screen or changes how an existing one looks. For a small change inside the baseline, such as a button on an existing form, it skips the prototype and records that as an assumption.

Grill the questions that aren't about looks first (scope, states, data, routes), so the Variants build on settled ground. Every question about how a screen looks (layout, hierarchy, density, colour, type) goes to the prototype instead.

The spec then gets a `## Prototype` section, which is the design Stage's whole brief:

- **Question**: what the prototype settles, in one line.
- **Routes**: each route to cover, as the route manifest (`scripts/ui/routes.ts`) names it.
- **States**: each state to make reachable, with a `?state=` name (an empty list, a dialog, a validation error).
- **Settled**: what the grill decided that the Variants build on.
- **Baseline**: whether it is provisional.

A Slug Preview is already set up, so a `/setup` state can be tried only live, from a stack in its Variant's worktree (§ Live mode: Design Review).

With the section written, the grill moves the issue to In Design.

## The issue's Slug Previews

The design Stage takes down an earlier round's Slug Previews, and the implement Stage all of them. The issue's Slugs are the `slug-preview` deployments whose Slug starts with `ban-<n>-`:

```sh
gh api 'repos/dkomeza/banki/deployments?environment=slug-preview&per_page=100' \
  --jq '[.[] | .payload.slug | strings | select(startswith("ban-<n>-"))] | unique | .[]'
```

Take each one down with `gh workflow run slug-preview.yml -f slug=<slug> -f down=true`. A Slug that is down already stays down.

## Implement Stage: the Reference

1. **Verdict.** Read the Maintainer's comments since the Design Review hand-off. The verdict is a single winner, `<key>`, taken as it is. A mix, two candidates or no clear winner is a spec question.
2. **Capture.** Bring `<wt>-proto-<key>` to `origin/<branch>-proto-<key>` (as `stages.md` § Start does for `<wt>`). Spawn a fresh `prototyper` to capture the Reference of `<key>` in it (its § Capturing the Reference). When it reports, check that `reference/` on `origin/<branch>-proto-<key>` holds every route and state the Prototype section lists, at each viewport and theme.
3. **Fill** `<wt>/.ui/reference/` (§ Filling `.ui/reference/`).
4. **Design language.** When the baseline was provisional, write `docs/design.md` from the winner. When the verdict says a decision holds beyond this issue, it goes into `docs/design.md` too. Edit it in `<wt>` and commit it there as `docs: …`.
5. **Spec.** Add the UI criteria to the issue description, starting with "the screens match the Reference on `<branch>-proto-<key>`", plus anything the verdict adds. Add the winner, and why, to the Prototype section.
6. **Clean up.** Take down the issue's Slug Previews (§ The issue's Slug Previews). Then, in each `<wt>-proto-*` worktree, `bun run ui down`, `git worktree remove <path>` and `git branch -D <branch>-proto-<key>`; origin keeps the branches.

Done when `reference/` is on the winner's branch on origin, `<wt>/.ui/reference/` holds it, the spec names it, and none of the issue's Slug Previews is left up.

## Filling `.ui/reference/`

The Reference lives in `reference/` on the winner's branch, which the spec's UI criteria name. Every Stage fills `<wt>/.ui/reference/` from it at its start, so the implementer and the `ui-reviewer` find it there:

```sh
git -C <wt> fetch origin <branch>-proto-<key>
rm -rf <wt>/.ui/reference && mkdir -p <wt>/.ui/reference
git -C <wt> archive FETCH_HEAD:reference | tar -x -C <wt>/.ui/reference
```

## Step 3: implement

The implementer's prompt says this is a UI issue, so it checks its screens, and names `.ui/reference/` and `<branch>-proto-<key>` when the spec names a Reference. Its report lists the routes and states it checked on screen.

## Step 4: review

Spawn the `ui-reviewer` alongside the other two reviewers, with the same prompt. When the spec names a Reference, the reviewer checks against `.ui/reference/`.

## Step 5: triage

For a UI finding, open the PNG it cites first, and judge it from what is on screen.

## Step 7: shots in the PR body

After writing the body to `<wt>/.ui/pr-body.md`, run `bun run ui compare --body .ui/pr-body.md` in `<wt>`. It puts before/after shots of every route the branch changed into the body's Evidence section, between the `<!-- ui-shots -->` markers, with the PNGs in `<wt>/.ui/pr/` (see the README's `ui compare`). Look at the after-shots before going on. A non-zero exit means the branch's own side failed: the branch is broken, so get it fixed first. A base that couldn't start still exits 0, with after-only shots and a note.

When opening the PR, add one `--attach ./.ui/pr/<file>.png` per PNG in `.ui/pr/`. Run from `<wt>`, the body's `./.ui/pr/…` references name the attached files, and `gh` rewrites them to the uploaded images.

## Refreshing the shots

After a review round or an Acceptance fix that touched `apps/web/` has pushed, refresh the shots from `<wt>`: `gh pr view <pr> --json body --jq .body > .ui/pr-body.md`, `bun run ui compare --body .ui/pr-body.md`, then `gh pr edit <pr> --body-file .ui/pr-body.md --attach ./.ui/pr/<file>.png …` for each PNG in `.ui/pr/`.

## Live mode: Design Review

After a live design Stage, show the Variants and ask for the verdict:

1. Wait with a background `until` loop until each Variant's Slug Preview has reached `success` or `failure` (its deployment statuses, as the README's "Slug Previews" section reads them).
2. Move the issue to Design Review.
3. Give the Maintainer, per Variant, its link (`https://ban-<n>-<key>.banki.dkomeza.com` plus each route), its name and bet, and the `?state=` names, with the sign-in: a Preview's Email and Password. For a Variant whose Slug Preview failed, or a `/setup` state, start a stack in its worktree instead (`bun run ui up`, or `--before-setup`; bring the worktree to origin first) and give its URL from `.ui/stack.json` (with `&state=<name>` after a `setupUrl`, so the link keeps its Setup token) and the stack's sign-in (`EMAIL` and `PASSWORD` in `scripts/ui/stack.ts`). Each worktree's stack runs on its own ports, so every Variant can be up at once.
4. Ask with `AskUserQuestion` which Variant wins: one option per Variant, plus one for another round, with notes on what to keep, drop or mix.
5. Post the answer as a comment on the issue, in the Maintainer's words: the winner, or what the next round should try. Then move the issue to Todo for a winner, or back to In Design for another round. Run `bun run ui down` in every worktree you started a stack in.
