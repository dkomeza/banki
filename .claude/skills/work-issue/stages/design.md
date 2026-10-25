# Design Stage

Builds one round of Variants for the question in the issue's Prototype section, each on its own branch with its own Slug Preview. It runs in In Design, and as many rounds as the Maintainer asks for.

Follow [`../references/stages.md`](../references/stages.md) (paths, input, questions and stops, the result) and [`../references/ui.md`](../references/ui.md) throughout. A run after a stop builds the round from scratch, and the Variant branches it pushed before stopping count as taken.

## 1. Start

As `stages.md` § Start.

## 2. The round's brief

Read the issue's Prototype section (`ui.md` § The Prototype section): the question, the routes and states, what is settled, and whether the baseline is provisional.

On a later round (the issue has been in Design Review before), read also:

- the Maintainer's comments since the hand-off: what to keep, drop, mix or try next;
- the earlier Variants, from origin: their branches (`git ls-remote origin '<branch>-proto-*'`), whose keys are taken, and each one's `variant.md` (`git show origin/<branch>-proto-<key>:variant.md`), with its name, bet and states.

Feedback that contradicts what the spec has settled, or that you can't turn into Variants, is a spec question.

Done when you can write the brief: the question, the routes and states, what is settled, whether the baseline is provisional, the keys taken, and, on a later round, the feedback and the earlier Variant each new one builds on.

## 3. Build the Variants

The `prototyper` builds the round (`stages.md` § Builders: spawned live, followed yourself headless). Its prompt carries `<wt>`, `<branch>`, `<n>` and the brief.

Done when every Variant is pushed and its Slug Preview dispatched. Check that yourself, for each Variant:

- `origin/<branch>-proto-<key>` is at the commit it reports, and that commit has a `variant.md`;
- its Slug Preview is claimed: the issue's Slug Preview deployments (`ui.md` § The issue's Slug Previews) have one for `ban-<n>-<key>` at that commit, created after the dispatch. Wait for it as `stages.md` § Waits says. A Slug with no deployment and a failed `slug-preview` run was refused: dispatch it once more, and if that is refused too, the wait has failed.

## 4. Take down the earlier rounds

Take down every one of the issue's Slug Previews that isn't this round's (`ui.md` § The issue's Slug Previews). Their branches stay on origin.

## 5. End

As `stages.md` § End: the issue stays in In Design, and the result lists this round's `routes` and `variants`, each Variant with the commit you checked. Whoever runs the Stage waits for the Slug Previews before the hand-off to Design Review.
