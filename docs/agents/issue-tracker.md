# Issue tracker: Linear

Issues and specs for this repo live in Linear: workspace `banki-group`, team `Banki-group` (key `BAN`), project "Banki". Use the Linear MCP tools (`mcp__claude_ai_Linear__*`) for all operations. Issue identifiers look like `BAN-123`.

**Ask before creating, closing, or relabelling issues.** This is a solo project and Linear is just a progress log: no automations, cycles, or integrations.

## Conventions

- **Create an issue**: `save_issue` with team `BAN`, project "Banki", a title, a markdown description, and one of the existing labels (`Bug`, `Feature`, `Improvement`, `Chore`). New issues start in `Backlog` (or `Todo` if they're ready to work on).
- **Read an issue**: `get_issue` with the `BAN-123` identifier, plus `list_comments` for the discussion.
- **List issues**: `list_issues` filtered to project "Banki", with state/label filters as needed.
- **Comment**: `save_comment` on the issue.
- **Status**: Backlog → Todo → In Progress → Done / Canceled. Change it with `save_issue`.
- Don't create new labels. There's no triage label set, so skip any triage-label step a skill mentions (e.g. `to-spec`'s `ready-for-agent`).

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
