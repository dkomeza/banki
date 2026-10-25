import { asObject, asString, type Fetch, isRecord, parseJson } from "../lib/parse";

// What `runner stage` reads from Linear itself, with the Stage's own token:
// only the issue's branch, which says where its worktree and the Stage's
// result are. Everything else the Stage does in Linear goes through the
// linear-banki MCP server.

const API = "https://api.linear.app/graphql";
const QUERY = "query ($id: String!) { issue(id: $id) { branchName } }";

/**
 * How long to wait before each retry of a query a fresh token couldn't see.
 * A token minted just after another of the app's was revoked answers
 * "Entity not found" for every issue for under a second, then sees them all.
 */
export const BLIND_RETRIES_MS = [250, 500, 1_000, 2_000, 4_000];

/** Whether Linear's GraphQL errors are a fresh token's blindness, which a retry outlasts. */
export function blind(errors: unknown): boolean {
  return (
    Array.isArray(errors) &&
    errors.length > 0 &&
    errors.every(
      (error: unknown) =>
        isRecord(error) &&
        typeof error.message === "string" &&
        error.message.startsWith("Entity not found") &&
        isRecord(error.extensions) &&
        error.extensions.code === "INPUT_ERROR",
    )
  );
}

/**
 * Runs a GraphQL `attempt` and retries it while its errors are a fresh
 * token's blindness, then returns its last body, errors and all.
 */
export async function seeing(
  attempt: () => Promise<Record<string, unknown>>,
  sleep: (ms: number) => Promise<unknown> = Bun.sleep,
): Promise<Record<string, unknown>> {
  for (const wait of BLIND_RETRIES_MS) {
    const body = await attempt();
    if (!blind(body.errors)) return body;
    await sleep(wait);
  }
  return attempt();
}

export async function issueBranch(
  token: string,
  issue: string,
  signal?: AbortSignal,
  options: { fetch?: Fetch; sleep?: (ms: number) => Promise<unknown> } = {},
): Promise<string> {
  const fetchFn: Fetch = options.fetch ?? fetch;
  const body = await seeing(async () => {
    const res = await fetchFn(API, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: QUERY, variables: { id: issue } }),
      signal: AbortSignal.any([AbortSignal.timeout(30_000), ...(signal ? [signal] : [])]),
    });
    const text = await res.text();
    // A fresh token's blindness comes as a 400 at times, and a 200 at others.
    if (!res.ok && !(res.status === 400 && text.includes("Entity not found"))) {
      throw new Error(`Linear: HTTP ${res.status} reading ${issue}`);
    }
    return asObject(parseJson(text, "Linear"), "Linear");
  }, options.sleep);
  if (body.errors !== undefined) {
    throw new Error(`Linear: couldn't read ${issue}: ${JSON.stringify(body.errors).slice(0, 300)}`);
  }
  const found = asObject(body.data, "Linear data").issue;
  if (found === null || found === undefined) throw new Error(`Linear has no issue ${issue}`);
  return asString(asObject(found, "issue").branchName, "issue.branchName");
}
