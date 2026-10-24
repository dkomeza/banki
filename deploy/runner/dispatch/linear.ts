import {
  asArray,
  asNumber,
  asObject,
  asOptionalString,
  asString,
  type Fetch,
  isRecord,
  parseJson,
} from "../lib/parse";
import type { Comment } from "./closing";
import type { Ended } from "./housekeeping";
import type { Transition } from "./select";

// The Linear adapter for the Dispatcher and the supervisors, on Linear's
// GraphQL API with a token the Broker minted for this tick or this
// supervisor alone. It reads issues of project Banki, their status history
// and comments, and posts and changes only what the Dispatcher owns: statuses,
// assignees and comments.

const API = "https://api.linear.app/graphql";
const PROJECT = "Banki";
const TEAM = "BAN";
const PAGE = 100;

export type LinearIssue = {
  id: string;
  identifier: string;
  number: number;
  priority: number;
  createdAt: string;
  branch: string;
  description: string;
  status: string;
  assigneeId: string | null;
  teamId: string;
};

const ISSUE_FIELDS =
  "id identifier number priority createdAt branchName description state { name } assignee { id } team { id }";
const toIssue = (node: Record<string, unknown>): LinearIssue => ({
  id: asString(node.id, "issue.id"),
  identifier: asString(node.identifier, "issue.identifier"),
  number: asNumber(node.number, "issue.number"),
  priority: asNumber(node.priority, "issue.priority"),
  createdAt: asString(node.createdAt, "issue.createdAt"),
  branch: asString(node.branchName, "issue.branchName"),
  description: asOptionalString(node.description, "issue.description") ?? "",
  status: asString(asObject(node.state, "issue.state").name, "issue.state.name"),
  assigneeId: isRecord(node.assignee) ? asString(node.assignee.id, "issue.assignee.id") : null,
  teamId: asString(asObject(node.team, "issue.team").id, "issue.team.id"),
});

export type Linear = ReturnType<typeof linear>;

export function linear(token: string, options: { fetch?: Fetch; signal?: AbortSignal } = {}) {
  const fetchFn: Fetch = options.fetch ?? fetch;

  async function query(
    text: string,
    variables: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    const res = await fetchFn(API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "banki-runner",
      },
      body: JSON.stringify({ query: text, variables }),
      signal: AbortSignal.any([
        AbortSignal.timeout(30_000),
        ...(options.signal ? [options.signal] : []),
      ]),
    });
    const body = await res.text();
    if (!res.ok) throw new Error(`Linear: HTTP ${res.status}`);
    const parsed = asObject(parseJson(body, "Linear"), "Linear");
    if (parsed.errors !== undefined) {
      throw new Error(`Linear: ${JSON.stringify(parsed.errors).slice(0, 300)}`);
    }
    return asObject(parsed.data, "Linear data");
  }

  /** Every node of a connection, page by page. `at` picks the connection out of the data. */
  async function all(
    text: string,
    variables: Record<string, unknown>,
    at: (data: Record<string, unknown>) => unknown,
  ): Promise<Record<string, unknown>[]> {
    const nodes: Record<string, unknown>[] = [];
    let after: string | null = null;
    for (;;) {
      const connection = asObject(at(await query(text, { ...variables, after })), "connection");
      nodes.push(
        ...asArray(connection.nodes, "connection.nodes").map((node) => asObject(node, "node")),
      );
      const info = asObject(connection.pageInfo, "pageInfo");
      if (info.hasNextPage !== true) return nodes;
      after = asString(info.endCursor, "pageInfo.endCursor");
    }
  }

  return {
    /** The Runner app's own user ID. */
    async viewer(): Promise<string> {
      return asString(
        asObject((await query("{ viewer { id } }")).viewer, "viewer").id,
        "viewer.id",
      );
    },

    /** Project Banki's issues that aren't over. */
    async openIssues(): Promise<LinearIssue[]> {
      const nodes = await all(
        `query ($after: String) { issues(first: ${PAGE}, after: $after, filter: { project: { name: { eq: "${PROJECT}" } }, state: { type: { nin: ["completed", "canceled"] } } }) { nodes { ${ISSUE_FIELDS} } pageInfo { hasNextPage endCursor } } }`,
        {},
        (data) => data.issues,
      );
      return nodes.map(toIssue);
    },

    async issue(identifier: string): Promise<LinearIssue | undefined> {
      const data = await query(`query ($id: String!) { issue(id: $id) { ${ISSUE_FIELDS} } }`, {
        id: identifier,
      });
      return isRecord(data.issue) ? toIssue(data.issue) : undefined;
    },

    /** The issue's status changes, oldest first, and when its assignee last changed. */
    async history(id: string): Promise<{ statuses: Transition[]; assignedAt: string | undefined }> {
      const nodes = await all(
        `query ($id: String!, $after: String) { issue(id: $id) { history(first: ${PAGE}, after: $after) { nodes { createdAt fromState { name } toState { name } fromAssignee { id } toAssignee { id } } pageInfo { hasNextPage endCursor } } } }`,
        { id },
        (data) => asObject(data.issue, "issue").history,
      );
      const assignedAt = nodes
        .filter((node) => isRecord(node.toAssignee) || isRecord(node.fromAssignee))
        .map((node) => asString(node.createdAt, "history.createdAt"))
        .toSorted()
        .at(-1);
      const statuses = nodes
        .filter((node) => isRecord(node.toState))
        .map((node) => ({
          at: asString(node.createdAt, "history.createdAt"),
          from: isRecord(node.fromState)
            ? asString(node.fromState.name, "history.fromState.name")
            : null,
          to: asString(asObject(node.toState, "history.toState").name, "history.toState.name"),
        }))
        .toSorted((a, b) => a.at.localeCompare(b.at));
      return { statuses, assignedAt };
    },

    async comments(id: string): Promise<Comment[]> {
      const nodes = await all(
        `query ($id: String!, $after: String) { issue(id: $id) { comments(first: ${PAGE}, after: $after) { nodes { id body createdAt user { id } parent { id } } pageInfo { hasNextPage endCursor } } } }`,
        { id },
        (data) => asObject(data.issue, "issue").comments,
      );
      return nodes.map((node) => ({
        id: asString(node.id, "comment.id"),
        body: asString(node.body, "comment.body"),
        createdAt: asString(node.createdAt, "comment.createdAt"),
        userId: isRecord(node.user) ? asString(node.user.id, "comment.user.id") : null,
        parentId: isRecord(node.parent) ? asString(node.parent.id, "comment.parent.id") : null,
      }));
    },

    /** Which of the team's issues by number are over, and how. */
    async ended(numbers: readonly number[]): Promise<Map<number, Ended>> {
      const ended = new Map<number, Ended>();
      if (numbers.length === 0) return ended;
      const nodes = await all(
        `query ($numbers: [Float!], $after: String) { issues(first: ${PAGE}, after: $after, filter: { team: { key: { eq: "${TEAM}" } }, number: { in: $numbers } }) { nodes { number state { type } } pageInfo { hasNextPage endCursor } } }`,
        { numbers },
        (data) => data.issues,
      );
      for (const node of nodes) {
        const type = asString(asObject(node.state, "issue.state").type, "issue.state.type");
        if (type === "completed" || type === "canceled")
          ended.set(asNumber(node.number, "issue.number"), type);
      }
      return ended;
    },

    /** The team's workflow states, by name. */
    async states(teamId: string): Promise<Map<string, string>> {
      const nodes = await all(
        `query ($id: String!, $after: String) { team(id: $id) { states(first: ${PAGE}, after: $after) { nodes { id name } pageInfo { hasNextPage endCursor } } } }`,
        { id: teamId },
        (data) => asObject(data.team, "team").states,
      );
      return new Map(
        nodes.map((node) => [asString(node.name, "state.name"), asString(node.id, "state.id")]),
      );
    },

    /** Sets the issue's status and, when given, its assignee (null unassigns it). */
    async update(
      id: string,
      input: { stateId?: string; assigneeId?: string | null },
    ): Promise<void> {
      const data = await query(
        "mutation ($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success } }",
        {
          id,
          input,
        },
      );
      if (asObject(data.issueUpdate, "issueUpdate").success !== true)
        throw new Error(`Linear didn't update ${id}`);
    },

    /** Posts a top-level comment, and returns its ID. */
    async comment(issueId: string, body: string): Promise<string> {
      const data = await query(
        "mutation ($input: CommentCreateInput!) { commentCreate(input: $input) { success comment { id } } }",
        { input: { issueId, body } },
      );
      const created = asObject(data.commentCreate, "commentCreate");
      if (created.success !== true) throw new Error(`Linear didn't comment on ${issueId}`);
      return asString(asObject(created.comment, "commentCreate.comment").id, "comment.id");
    },
  };
}

/** Sets an issue's status by name, unless it is that already. */
export async function moveTo(
  client: Linear,
  issue: LinearIssue,
  status: string,
  assigneeId?: string | null,
): Promise<void> {
  const states = await client.states(issue.teamId);
  const stateId = states.get(status);
  if (stateId === undefined)
    throw new Error(`Linear has no status ${JSON.stringify(status)} in ${issue.identifier}'s team`);
  await client.update(issue.id, { stateId, ...(assigneeId === undefined ? {} : { assigneeId }) });
}
