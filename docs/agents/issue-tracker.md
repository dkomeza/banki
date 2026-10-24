# Issue tracker: Linear

Issues and specs for this repo live in Linear: workspace `banki-group`, team `Banki` (key `BAN`), project "Banki". Issue identifiers look like `BAN-123`.

In a session, use the `linear-banki` MCP server (`mcp__linear-banki__*`) for all operations, not the generic claude.ai Linear connector (`mcp__claude_ai_Linear__*`). A headless Stage on the Runner uses the `linear-banki` MCP server too, authenticated as the Runner app: `runner stage` gives each Stage its own `linear-banki` server (Linear's, at `https://mcp.linear.app/mcp`) with a token minted for that Stage alone, and no other MCP server (README § Runner). The operations below are the same either way, named by their MCP tools, and what a Stage posts or changes comes from the Runner app.

**Ask before creating, closing, or relabelling issues.** This is a solo project with no cycles. An issue's status drives the agent pipeline (below, and ADR-0013). The one integration is GitHub: a branch named after the issue's `gitBranchName` links its PR to the issue, and merging the PR moves the issue to `Done`.

The **Maintainer** (`CONTEXT.md`) is the Linear user Dawid Komęza (`dkomeza`). Only their comments, and the Runner app's own, count as input to a Stage or to the Dispatcher.

Linear is the source of truth for requirements (there's no manifest in the repo). The project document **"Banki — Overview"** (https://linear.app/banki-group/document/banki-overview-de9b92093f2e) gives the big picture; read it before working on any issue. Each issue holds the detailed requirements for its own piece.

## Structure

- **Milestones `M1 · …` to `M10 · …`** split the MVP into areas, in build order. Every MVP issue belongs to one.
- **`Later: …` issues** with no milestone are post-MVP.

## Conventions

- **Create an issue**: `save_issue` with team `BAN`, project "Banki", the milestone it belongs to, a title, a markdown description, and one of the existing labels (`Bug`, `Feature`, `Improvement`, `Chore`). New issues start in `Backlog`: an issue in `Todo` is ready for the implement Stage, which needs a grilled spec.
- **Read an issue**: `get_issue` with the `BAN-123` identifier, plus `list_comments` for the discussion. Also read the overview doc, and skim the other issues in the same milestone for context.
- **List issues**: `list_issues` filtered to project "Banki", with state/label filters as needed.
- **Comment**: `save_comment` on the issue, top-level. **Reply in a thread**: `save_comment` with the `parentId` of the thread's first comment.
- **Status**: change it with `save_issue` (§ Statuses).
- **Assign or unassign**: `save_issue` with the assignee, the Maintainer or none.
- **Status history**: `get_issue` with the `stateHistory` field, which dates each status change. The Stages read the hand-off from it (`.claude/skills/work-issue/references/stages.md` § Hand-offs).
- Don't create new labels. There's no triage label set, so skip any triage-label step a skill mentions (e.g. `to-spec`'s `ready-for-agent`).

## Statuses

An issue's status says which Stage comes next, and whose move it is:

| Status        | Whose move       | What happens                                                                                                                                          |
| ------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backlog       | Maintainer, live | The grill (`/work-issue`). It ends by moving the issue to In Design (a question about looks to prototype) or Todo, unassigned unless it goes on live. |
| In Design     | Agent            | The design Stage builds the Variants, each with a Slug Preview. Once they're up, the hand-off moves the issue to Design Review.                       |
| Design Review | Maintainer       | They try the Variants. Forward to Todo with the verdict in a comment, or back to In Design with a comment for another round.                          |
| Todo          | Agent            | The implement Stage: the Reference, then the implementation, the reviews and the PR. It ends in In Review.                                            |
| In Review     | Agent            | Review rounds and Acceptance fixes. Once the rounds end and the PR Preview is up, the hand-off moves the issue to Acceptance.                         |
| Acceptance    | Maintainer       | They try the PR Preview. Approve and merge (→ Done), or back to In Review with a comment.                                                             |
| In Progress   | Agent            | A Stage is running on the Runner. The status before it comes back when the Stage ends.                                                                |
| Done          | none             | Set by Linear when the PR merges.                                                                                                                     |

A non-UI issue goes through the same statuses, skipping In Design and Design Review; in Acceptance there is just less to try.

**Whose move.** Design Review and Acceptance are the Maintainer's. There the issue stays unassigned, and the hand-off comment @mentions them. In the agents' statuses, an issue assigned to the Maintainer is theirs to hold: a Stage stopped on them, or they're running it live. The Dispatcher leaves it alone.

**Live mode** is the one exception to "unassigned": a live `/work-issue` keeps the issue assigned to the Maintainer from the grill to its Checkpoint 2, Design Review and Acceptance included, and ends by unassigning it in Acceptance. A live session that ends early hands the issue to the Runner by unassigning it where it stands.

**Closing comments.** Each Stage ends with a top-level comment holding its summary and its whole result (`.claude/skills/work-issue/references/stages.md` § The closing comment). Headless the Dispatcher posts it, and live mode posts the same one. What already ran on an issue is read back from these comments, by the Runner app or the Maintainer, so a live session that ends early hands over exactly where it stood.

**Handing back a stop.** A stop asks its question in a top-level closing comment. Only the Maintainer's reply in that comment's thread answers it and hands the issue back: the Dispatcher unassigns the issue and runs the Stage again. A top-level comment never hands an issue back, so the comments live mode posts (verdicts, feedback, hand-offs) leave its assignment alone.

## When a skill says "publish to the issue tracker"

Create a Linear issue in project "Banki" (after confirming with the user).

## When a skill says "fetch the relevant ticket"

`get_issue` with the `BAN-…` identifier, plus `list_comments`.

## Wayfinding operations

Used by `/wayfinder`.

- **Map**: a parent issue titled `Map: <destination>`, holding the Notes / Decisions-so-far / Fog body.
- **Child ticket**: a sub-issue of the map, titled `<type>: <question>` (`research`/`prototype`/`grilling`/`task`) instead of using `wayfinder:*` labels.
- **Blocking**: Linear's native "blocked by" relations. A ticket is unblocked when every blocker is Done or Canceled.
- **Frontier query**: the map's open sub-issues with no open blockers and no assignee; first in map order wins.
- **Claim**: assign the ticket to the user and move it to In Progress.
- **Resolve**: comment with the answer, move it to Done, then append a gist + link to the map's Decisions-so-far.
