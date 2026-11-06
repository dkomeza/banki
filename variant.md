# j: Margin, notes at the mark

Builds on d (Margin), as the Maintainer asked: the mistakes are marked as in d, with no number, and each one's note opens in a bubble just under it, on hover with a mouse or on a tap on a phone (Tab reaches them too; Escape or a tap elsewhere puts it away). With the notes on the mistakes, d's margin holds the Feedback alone: from 1024 px it runs beside your answer and the Back and stays in view (sticky) while a long Back, pictures and all, scrolls past. Below 1024 px the Feedback comes after your answer and before the Back, and once it has scrolled away a slim tab under the header keeps the suggestion in view and drops the whole Feedback down over the Back. The dock is d's.

States: grading, grading-selected, graded, graded-mistakes, grade-failed, no-key

Routes: `/decks/5eed0000-0000-4000-8000-000000000002/study` (Calculus 2, write-and-grade). The plain load is the first Card's Front; write an answer and Check, and the stubbed Grader answers after about 2.5 s with a canned grade. The state pill at the bottom steps through the states. `graded-mistakes` shows the Maclaurin series Card, its Back now with a plot, in place of the first one (Edit opens the real one).
