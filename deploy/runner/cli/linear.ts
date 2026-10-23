import { asObject, asString, parseJson } from "../lib/parse";

// What `runner stage` reads from Linear itself, with the Stage's own token:
// only the issue's branch, which says where its worktree and the Stage's
// result are. Everything else the Stage does in Linear goes through the
// linear-banki MCP server.

const API = "https://api.linear.app/graphql";
const QUERY = "query ($id: String!) { issue(id: $id) { branchName } }";

export async function issueBranch(
  token: string,
  issue: string,
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetch(API, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: QUERY, variables: { id: issue } }),
    signal: AbortSignal.any([AbortSignal.timeout(30_000), ...(signal ? [signal] : [])]),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Linear: HTTP ${res.status} reading ${issue}`);
  const body = asObject(parseJson(text, "Linear"), "Linear");
  if (body.errors !== undefined) {
    throw new Error(`Linear: couldn't read ${issue}: ${JSON.stringify(body.errors).slice(0, 300)}`);
  }
  const found = asObject(body.data, "Linear data").issue;
  if (found === null || found === undefined) throw new Error(`Linear has no issue ${issue}`);
  return asString(asObject(found, "issue").branchName, "issue.branchName");
}
