# Linear statuses drive the Stages, through a Dispatcher without an LLM

An issue's Linear status says which Stage comes next, and whose move it is. Design Review and Acceptance are the Maintainer's. The Runner's hand-off comment there @mentions them, and the issue stays unassigned. In the agents' statuses, being assigned to the Maintainer means they hold it: a Stage stopped on them, or they're running it live. The Maintainer's verdicts are status changes too. Moving forward from Design Review or Acceptance approves. Moving back, with a comment, asks for another round. So the Dispatcher, a plain program on a timer, decides what to start from statuses, assignees and comment timestamps alone, and it spends no tokens deciding or waiting on CI and the review bots. A usage gate in front of it protects the weekly limit the Runner shares with the Maintainer's own work.

| Status        | Whose move       | What happens                                                                                  |
| ------------- | ---------------- | --------------------------------------------------------------------------------------------- |
| Backlog       | Maintainer, live | The grill. It ends by moving the issue to In Design (a UI question to prototype) or Todo.     |
| In Design     | Agent            | A Stage builds the Variants, each on its own branch with a Slug Preview.                      |
| Design Review | Maintainer       | They try the Variants. Forward to Todo with the verdict, or back to In Design with a comment. |
| Todo          | Agent            | A Stage captures the Reference, implements, reviews and opens the pull request.               |
| In Review     | Agent            | Rounds against `claude-review` and Codex, and fixes for Acceptance feedback.                  |
| Acceptance    | Maintainer       | They try the PR Preview. Merge (→ Done), or back to In Review with a comment.                 |
| In Progress   | Agent            | A Stage is running. The status before it is restored when the Stage ends.                     |

## Considered Options

- **The assignee alone**, with an LLM reading the Maintainer's comment to tell a verdict from feedback or approval: rejected. A misread approval starts a Stage nobody asked for.
- **Commands in comments** (`/approve`, `/revise`): rejected. They're precise, but easy to get wrong on a phone.
- **Labels**: rejected. Statuses already form the board, and a status holds one value where labels can contradict each other.
- **Assigning the Maintainer in Design Review and Acceptance**: rejected. Moving the issue back would leave it assigned, and the Dispatcher skips assigned issues. A saved view of the two statuses is the Maintainer's inbox instead.

## Consequences

- When a Stage stops on the Maintainer mid-status (a spec question, a failure, review rounds that stop converging), it comments and assigns them. Any later comment from them hands the issue back: the Dispatcher unassigns it and queues the Stage. A live run's assignment has no such question, so a comment leaves it alone.
- In Design Review and Acceptance a comment alone starts nothing: the Maintainer's feedback goes with moving the issue back, and the next Stage reads every comment since the hand-off.
- The Dispatcher keeps no state of its own. While a Stage runs, the issue sits in In Progress. Afterwards the Stage sets the next status, or, after a crash, the Dispatcher restores the one before In Progress from the issue's status history.
- `rate_limit_event` comes once, at the start of a `claude -p` run, so the gate reads usage between Stages only, with a one-line Haiku call. A Stage starts only if the weekly utilization, plus the estimates of the Stages already running, plus its own, stays under the Ceiling (60% by default), and the five-hour window is under 80%. Estimates are learned per kind of Stage from the before/after readings.
- Stages start inside a nightly window (01:00–07:00 server time), at most two at once and never two on one issue, plus `run-now` over SSH. A Stage that is running finishes even past the window or the Ceiling.
- A live `/work-issue` on the laptop assigns the issue to the Maintainer, which keeps the Dispatcher off it. It ends where the Runner would.
