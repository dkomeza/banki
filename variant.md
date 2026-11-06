# k: Margin, one voice

Builds on d (Margin), as the Maintainer asked, with everything the Grader says in one panel that never leaves the screen. The mistakes are marked as in d, with no number; hovering one (or tapping it on a phone) shows its note at the top of the Feedback panel, laid over the Feedback so nothing moves, until the pointer moves on. From 1024 px the panel is d's margin, held in view (sticky) beside your answer and a long Back, pictures and all. Below 1024 px the panel rides on top of the dock, so it is always in reach: one line with the suggestion and the start of the Feedback, which opens to the whole of it, and which shows a mistake's note when you tap the mistake. The ratings are d's.

States: grading, grading-selected, graded, graded-mistakes, grade-failed, no-key

Routes: `/decks/5eed0000-0000-4000-8000-000000000002/study` (Calculus 2, write-and-grade). The plain load is the first Card's Front; write an answer and Check, and the stubbed Grader answers after about 2.5 s with a canned grade. The state pill at the bottom steps through the states. `graded-mistakes` shows the Maclaurin series Card, its Back now with a plot, in place of the first one (Edit opens the real one).
