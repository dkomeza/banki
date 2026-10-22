# UI issues

The parts of `work-issue` that only a UI issue takes, by step. They use the `ui` script (the README's "Seeing the UI" section), whose stacks and shots live under `.ui/` in each worktree.

## The design baseline

`docs/design.md` is Banki's design language in words: the direction and why, the layout conventions, type, density, how screens use colour. The values stay in `apps/web/src/index.css`; `docs/design.md` says what they are for. Prototypes, the implementer and the `ui-reviewer` all work within it, and changing it is a decision the user makes in a grill.

Until `docs/design.md` exists, the baseline is **provisional**: the "Paper & ink" tokens and the shell BAN-8 shipped were built without a prototype. So the first prototype settles direction as well as structure. One variant keeps Paper & ink, and the others propose different directions (palette, type, density). The run then writes `docs/design.md` from the winner.

## Step 2: prototype

A prototype settles how a screen looks, which a question can't: the user judges it in a browser, on seed data, at real sizes. Run one when the issue adds a screen or changes how an existing one looks. For a small change inside the baseline, such as a button on an existing form, skip it and record that as an assumption.

Grill the questions that aren't about looks first (scope, states, data, routes), so the variants build on settled ground. Every question about how a screen looks (layout, hierarchy, density, colour, type) goes to the prototype.

1. Create a prototype worktree off the issue branch: `git worktree add <wt>-prototype -b <branch>-prototype <branch>`. The variants live only there, so `<wt>` stays clean.
2. Spawn the `prototyper` agent. Its prompt carries `<wt>-prototype`, the question in one line, the routes and states to cover, what the grill has settled, and whether the baseline is provisional. Keep its agent ID for later rounds.
3. When it reports, start a stack in `<wt>-prototype` in the mode its routes need (their route manifest entries in `scripts/ui/routes.ts`):
   - signed-in and signed-out routes: `bun run ui up`. Give the user the URL from `.ui/stack.json` and the sign-in (the stack's `EMAIL` and `PASSWORD` in `scripts/ui/stack.ts`).
   - `/setup`: `bun run ui up --before-setup`. Give the user the `setupUrl` from `.ui/stack.json`.

   A stack runs in one mode at a time, so a prototype that covers both shows one mode, then `bun run ui down` and the other. With the links go each `?variant=` key with its name and bet, and each `&state=` key.

4. Ask with `AskUserQuestion` which variant wins: one option per variant, plus one for a mix, with notes. The answer is often a mix ("B's header with C's nav"). Resume the prototyper with it for another round. Allow at most 2 rounds in all.
5. Capture the winner in `<wt>-prototype`:
   - Run `bun run ui down`, so the prototyper can start a stack in whichever mode it needs. Then resume it to capture the winner into `.ui/shots/reference/`: every route and state it covers, at each viewport and theme. Check that every route and state is there, then copy the folder to `<wt>/.ui/reference/`. That folder is the **reference**: the approved design, which the spec points at, the implementer builds to and the `ui-reviewer` checks against.
   - Commit the variants and push `<branch>-prototype`. Then run `bun run ui down`, `git worktree remove <wt>-prototype` and `git branch -D <branch>-prototype`; origin keeps the branch.
   - Comment on the issue with the question, the winning variant and why, and the branch.
6. Fold the outcome into the grill. A decision that holds beyond this issue goes into `docs/design.md`, edited in `<wt>` and committed as `docs: …`. The rest becomes UI criteria in the spec, which names the reference: "the screens match `.ui/reference/` (variant `<key>` on `<branch>-prototype`)".

Done when the user has picked a winner, `.ui/reference/` holds its shots, the branch is pushed and the issue has the comment.

## Step 3: implement

The implementer's prompt says this is a UI issue, so it checks its screens, and names `.ui/reference/` and `<branch>-prototype` when there is a prototype. Its report lists the routes and states it checked on screen.

## Step 4: review

Spawn the `ui-reviewer` alongside the other two reviewers, with the same prompt. The spec names `.ui/reference/` when there is one, and the reviewer checks against it.

## Step 5: triage

For a UI finding, open the PNG it cites first, and judge it from what is on screen.

## Step 7: shots in the PR body

After writing the body to `<wt>/.ui/pr-body.md`, run `bun run ui compare --body .ui/pr-body.md` in `<wt>`. It puts before/after shots of every route the branch changed into the body's Evidence section, between the `<!-- ui-shots -->` markers, with the PNGs in `<wt>/.ui/pr/` (see the README's `ui compare`). Look at the after-shots before going on. A non-zero exit means the branch's own side failed: the branch is broken, so get it fixed first. A base that couldn't start still exits 0, with after-only shots and a note.

When opening the PR, add one `--attach ./.ui/pr/<file>.png` per PNG in `.ui/pr/`. Run from `<wt>`, the body's `./.ui/pr/…` references name the attached files, and `gh` rewrites them to the uploaded images.

## Step 8: refreshing the shots

When a round's fixes touched `apps/web/`, refresh the shots from `<wt>` after the push: `gh pr view <n> --json body --jq .body > .ui/pr-body.md`, `bun run ui compare --body .ui/pr-body.md`, then `gh pr edit <n> --body-file .ui/pr-body.md --attach ./.ui/pr/<file>.png …` for each PNG in `.ui/pr/`.
