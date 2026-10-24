# Linear statuses drive the Stages, through a Dispatcher without an LLM

An issue's Linear status says which Stage comes next, and whose move it is. Design Review and Acceptance are the Maintainer's. The Runner's hand-off comment there @mentions them, and the issue stays unassigned (a live run is the exception, below). In the agents' statuses, being assigned to the Maintainer means they hold it: a Stage stopped on them, or they're running it live. The Maintainer's verdicts are status changes too. Moving forward from Design Review or Acceptance approves. Moving back, with a comment, asks for another round. So the Dispatcher, a plain program on a timer, decides what to start from statuses, assignees and comment timestamps alone, and it spends no tokens deciding or waiting on CI and the review bots. A usage gate in front of it protects the weekly limit the Runner shares with the Maintainer's own work.

| Status        | Whose move       | What happens                                                                                  |
| ------------- | ---------------- | --------------------------------------------------------------------------------------------- |
| Backlog       | Maintainer, live | The grill. It ends by moving the issue to In Design (a UI question to prototype) or Todo.     |
| In Design     | Agent            | A Stage builds the Variants, each on its own branch with a Slug Preview.                      |
| Design Review | Maintainer       | They try the Variants. Forward to Todo with the verdict, or back to In Design with a comment. |
| Todo          | Agent            | A Stage captures the Reference, implements, reviews and opens the pull request.               |
| In Review     | Agent            | Rounds against `claude-review`, and fixes for Acceptance feedback.                            |
| Acceptance    | Maintainer       | They try the PR Preview. Merge (→ Done), or back to In Review with a comment.                 |
| In Progress   | Agent            | A Stage is running. The status before it is restored when the Stage ends.                     |

## Considered Options

- **The assignee alone**, with an LLM reading the Maintainer's comment to tell a verdict from feedback or approval: rejected. A misread approval starts a Stage nobody asked for.
- **Commands in comments** (`/approve`, `/revise`): rejected. They're precise, but easy to get wrong on a phone.
- **Labels**: rejected. Statuses already form the board, and a status holds one value where labels can contradict each other.
- **A run record on the Runner's volume** as the Dispatcher's memory of what already ran: rejected. A live session that ends early hands the issue to the Runner where it stands, and the Runner can't see the results the laptop wrote.
- **Rerunning a Stage from its start** after it hits the five-hour limit: rejected. It dies part-way with work only in its worktree, so a fresh run either redoes hours of it or stops on the Maintainer at its start.
- **Assigning the Maintainer in Design Review and Acceptance**: rejected. Moving the issue back would leave it assigned, and the Dispatcher skips assigned issues. A saved view of the two statuses is the Maintainer's inbox instead.

## Consequences

- When a Stage stops on the Maintainer mid-status (a spec question, a failure, review rounds that stop converging), the Dispatcher asks its question in a top-level comment and assigns them. Headless, a Stage leaves statuses, assignees and comments in Linear to the Dispatcher, which posts them from the Stage's result. Only their reply in that comment's thread hands the issue back: the Dispatcher unassigns it and queues the Stage. A top-level comment never does, so the verdicts, feedback and hand-offs a live run posts leave its assignment alone.
- In Design Review and Acceptance a comment alone starts nothing: the Maintainer's feedback goes with moving the issue back, and the next Stage reads every comment since the hand-off.
- The Dispatcher keeps no state of its own about the issues. While a Stage runs, the issue sits in In Progress. When it ends, the Dispatcher posts the Stage's closing comment, which holds the Stage's whole result, and sets the next status from it. After a crash it restores the status from before In Progress, which it reads from the issue's status history. What already ran on an issue is read back from those closing comments: a round of Variants built, a review round on this head commit, the Stage a stop waits on. Live mode posts the same comments, so an issue a live session leaves part-way goes on on the Runner exactly where it stood. The Runner's volume keeps only the gate's readings, the records of the Stages running or paused (each one's supervisor, its runs and, when paused, its session), the Stages' costs and their logs.
- A Stage that hits the five-hour limit is paused, with its issue left In Progress, and resumed in its own `claude` session after `resetsAt`, inside the window. Its work in progress in the worktree is neither lost nor done twice.
- Codex isn't one of the review bots: the Maintainer's plan has it review their own pull requests only, never the App's. `claude-review` is the one bot, live and headless.
- `rate_limit_event` comes once, at the start of a `claude -p` run, so the gate reads usage between Stages only, with a one-line Haiku call. A Stage starts only if the weekly utilization, plus the estimates of the Stages already running, plus its own, stays under the Ceiling (60% by default), and the five-hour window is under 80%. Estimates are learned per kind of Stage from the before/after readings.
- Stages start inside a window, at most two at once and never two on one issue, plus `run-now` over SSH. The window is every night (01:00–07:00 server time) and all of Saturday and Sunday, when the Maintainer's own use is light. The five-hour check and the Ceiling still guard what they do use. A Stage that is running finishes even past the window or the Ceiling.
- A live `/work-issue` on the laptop keeps the issue assigned to the Maintainer throughout, Design Review and Acceptance included, which keeps the Dispatcher off it. It ends where the Runner would, unassigned in Acceptance. A live session that ends early hands the issue to the Runner by unassigning it.
