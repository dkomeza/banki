# Design Stage

Builds one round of Variants for the question in the issue's Prototype section, each on its own branch with its own Slug Preview. It runs in In Design, and as many rounds as the Maintainer asks for.

Follow [`../references/stages.md`](../references/stages.md) (paths, input, questions and stops, the result) and [`../references/ui.md`](../references/ui.md) throughout. A run after a stop builds the round from scratch, and the Variant branches it pushed before stopping count as taken.

## 1. Start

As `stages.md` § Start.

## 2. The round's brief

Read the issue's Prototype section (`ui.md` § The Prototype section): the question, the routes and states, what is settled, and whether the baseline is provisional.

On a later round (the issue has been in Design Review before), read also:

- the Maintainer's comments since the hand-off: what to keep, drop, mix or try next;
- the Variants the last hand-off comment lists, and their branches on origin (`git ls-remote origin '<branch>-proto-*'`). Those branches' keys are taken.

Feedback that contradicts what the spec has settled, or that you can't turn into Variants, is a spec question.

Done when you can write the brief: the question, the routes and states, what is settled, whether the baseline is provisional, the keys taken, and, on a later round, the feedback and the earlier Variant each new one builds on.

## 3. Build the Variants

Spawn the `prototyper` agent to build the round. Its prompt carries `<wt>`, `<branch>`, `<n>` and the brief.

Done when it reports every Variant pushed and its Slug Preview dispatched. Check that yourself: each `origin/<branch>-proto-<key>` is at the commit it reports, and `gh run list --workflow slug-preview.yml` has a run for each Slug since the dispatch.

## 4. Take down the earlier rounds

Take down every one of the issue's Slug Previews that isn't this round's (`ui.md` § The issue's Slug Previews). Their branches stay on origin.

## 5. End

As `stages.md` § End: the issue stays in In Design, and the result lists this round's `routes` and `variants`. Whoever runs the Stage waits for the Slug Previews before the hand-off to Design Review.
