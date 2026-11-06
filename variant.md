# h: Margin, verdict first

Builds on d (Margin), with the Grader's verdict read first instead of last. Under the Front, a strip whose height is held from Check says what the Grader suggests and the Feedback's first paragraph; "Full feedback" opens the rest in place, so the long explanation is there when you want it and out of the way when you don't. Your answer and the Back follow, with d's margin notes beside your answer from 1024 px; below 1024 px each mistake's number is a button that opens its note under the paragraph. Missing parts are one even tint with a solid underline. In the dock, Confirm sits in the row above the ratings, beside "Still grading", instead of floating over them.

States: grading, grading-selected, graded, graded-mistakes, grade-failed, no-key

Routes: `/decks/5eed0000-0000-4000-8000-000000000002/study` (Calculus 2, write-and-grade). The plain load is the first Card's Front; write an answer and Check, and the stubbed Grader answers after about 2.5 s with a canned grade. The state pill at the bottom steps through the states. `graded-mistakes` shows the Maclaurin series Card in place of the first one (Edit opens the real one).
