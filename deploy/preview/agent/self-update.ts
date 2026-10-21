import { shortSha } from "./naming";

// Whether the agent rebuilds itself (ADR-0009): it runs the commit the helper
// built it from, and when anything under deploy/preview/ differs on `main`, it
// moves onto `main`. It is pure: clone.ts observes, this decides, helper.ts
// acts.

/** Everything under it is the agent: its code, its Dockerfile, its Compose files. */
const AGENT_DIR = "deploy/preview/";

export type UpdateCheck = {
  /** The commit the running agent was built from (BANKI_PREVIEW_COMMIT), empty when started by hand. */
  running: string;
  /** The `main` the clone has just fetched. */
  main: string;
  /** The paths that differ between `running` and `main`, or undefined when the clone can't tell. */
  changedPaths: string[] | undefined;
  /** The `main` commits whose update failed since this agent started. */
  failed: ReadonlySet<string>;
};

export type UpdateDecision =
  | { kind: "current" }
  /** That `main` failed once already, so it waits for the next one, or a restart. */
  | { kind: "failed-before" }
  | { kind: "update"; why: string };

export function updateDecision(check: UpdateCheck): UpdateDecision {
  if (check.running === check.main) return { kind: "current" };
  if (check.failed.has(check.main)) return { kind: "failed-before" };
  // Whatever a person starts converges on `main` within one loop.
  if (!isCommit(check.running)) return { kind: "update", why: "this agent was started by hand" };
  if (check.changedPaths === undefined) {
    return { kind: "update", why: `its commit ${shortSha(check.running)} isn't on main` };
  }
  if (check.changedPaths.some((path) => path.startsWith(AGENT_DIR))) {
    return { kind: "update", why: `${AGENT_DIR} changed since ${shortSha(check.running)}` };
  }
  return { kind: "current" };
}

/** A full commit SHA, the only form a commit is passed to git in. */
export const isCommit = (value: string) => /^[0-9a-f]{40}$/.test(value);
