# d: Margin

The Card keeps its reading column (Your answer, then the Back), and from 1024 px the Grader writes in a margin beside it, like a marker on an essay: each mistake's note level with its mistake (red tags in the answer, matching numbered notes in the margin), and the Feedback level with the Back it is about, its place held by a sketched box from Check so the column never moves when the result lands. Below 1024 px there is no margin: the Feedback, with the notes under it, comes after the Back at the end of the page, so landing only lengthens it. The missing part is tinted with a dashed accent underline. In the dock the suggested rating is filled in the accent; a selection before it is ringed in ink, and a "Confirm Hard" callout rises over the ratings above it.

States: grading, grading-selected, graded, graded-mistakes, grade-failed, no-key

Routes: `/decks/5eed0000-0000-4000-8000-000000000002/study` (Calculus 2, write-and-grade). The plain load is the first Card's Front; write an answer and Check, and the stubbed Grader answers after about 2.5 s with a canned grade. `graded-mistakes` shows the Maclaurin series Card in place of the first one (Edit opens the real one).
