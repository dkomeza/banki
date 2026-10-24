import { basename } from "node:path";

// What each tick tidies on the Runner: Stage logs older than 30 days, a
// canceled issue's Variant Slug Previews, and, once clean and pushed, the
// worktrees of Done or Canceled issues, Variant worktrees included (as
// `/work-issue` step 0 does on the laptop). Pure, so it is unit-tested.

export const LOG_RETENTION_MS = 30 * 24 * 60 * 60_000;

/** Linear's workflow state types for an issue that is over. */
export type Ended = "completed" | "canceled";

export function expiredLogs(
  files: readonly { path: string; modified: Date }[],
  now: Date,
  /** Logs an active Stage still needs. */
  keep: ReadonlySet<string> = new Set(),
): string[] {
  return files
    .filter(
      (file) => now.getTime() - file.modified.getTime() > LOG_RETENTION_MS && !keep.has(file.path),
    )
    .map((file) => file.path);
}

/** The issue a Variant's Slug (`ban-<n>-<key>`) belongs to. */
export function issueOfSlug(slug: string): number | undefined {
  const match = /^ban-([1-9][0-9]*)-[a-z]+$/.exec(slug);
  return match === null ? undefined : Number(match[1]);
}

/** The issue a worktree (`ban-<n>-…`, a Variant's `…-proto-<key>` included) belongs to. */
export function issueOfWorktree(path: string): number | undefined {
  const match = /^ban-([1-9][0-9]*)-/.exec(basename(path));
  return match === null ? undefined : Number(match[1]);
}

/** The Slugs to take down: a canceled issue's, whose newest deployment isn't inactive yet. */
export function slugsToTakeDown(
  slugs: readonly { slug: string; state: string | null }[],
  ended: ReadonlyMap<number, Ended>,
): string[] {
  return slugs
    .filter((found) => {
      const issue = issueOfSlug(found.slug);
      return issue !== undefined && ended.get(issue) === "canceled" && found.state !== "inactive";
    })
    .map((found) => found.slug);
}

export type WorktreeFacts = {
  path: string;
  branch: string | undefined;
  /** `git status --porcelain` prints nothing. */
  clean: boolean;
  /** Every commit on it is on origin, on its branch or in its PR. */
  pushed: boolean;
};

export type Removal = { path: string; branch: string | undefined };

/** The worktrees of Done or Canceled issues that are clean and pushed, and why each other one of theirs stays. */
export function worktreesToRemove(
  worktrees: readonly WorktreeFacts[],
  ended: ReadonlyMap<number, Ended>,
): { remove: Removal[]; keep: { path: string; why: string }[] } {
  const remove: Removal[] = [];
  const keep: { path: string; why: string }[] = [];
  for (const worktree of worktrees) {
    const issue = issueOfWorktree(worktree.path);
    if (issue === undefined || !ended.has(issue)) continue;
    if (!worktree.clean) keep.push({ path: worktree.path, why: "it has uncommitted changes" });
    else if (!worktree.pushed)
      keep.push({ path: worktree.path, why: "it has commits origin doesn't" });
    else remove.push({ path: worktree.path, branch: worktree.branch });
  }
  return { remove, keep };
}
