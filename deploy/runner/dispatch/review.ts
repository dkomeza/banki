import type { Finding } from "./select";

// What the Dispatcher trusts from GitHub (ADR-0012): `claude-review` alone,
// and each of its parts only from the login that posts it, since this repo is
// public and anyone can paste a bot's text or markers. Pure, so it is
// unit-tested; github.ts reads them.

/** The `claude-review` check run's name, and the app that runs it. */
export const CLAUDE_REVIEW_CHECK = "claude-review";
export const ACTIONS_APP = "github-actions";
/** Who posts its summary comment: the workflow's own token. */
export const SUMMARY_AUTHOR = "github-actions[bot]";
export const SUMMARY_MARKER = "<!-- claude-review -->";
/** Who starts its inline review threads: the Claude GitHub App that claude-code-action posts as. */
export const THREAD_AUTHOR = "claude[bot]";

/**
 * The summary comment's commit and findings, as `.github/workflows/claude-review.yml`
 * writes them, or undefined when the body isn't one.
 */
export function parseSummary(body: string): { sha: string; findings: Finding[] } | undefined {
  if (!body.startsWith(SUMMARY_MARKER)) return undefined;
  const sha = /^At `([0-9a-f]{7,40})`/m.exec(body)?.[1];
  if (sha === undefined) return undefined;
  const findings = [...body.matchAll(/^\| (new|open|fixed) \| (blocker|major|minor) \|/gm)].map(
    (row) => ({
      status: row[1] ?? "",
      severity: row[2] ?? "",
    }),
  );
  return { sha, findings };
}

/**
 * Whether a review thread's first comment is `claude-review`'s, by its GraphQL
 * author, queried as `author { login kind: __typename }`.
 */
export function startedByClaudeReview(
  author: { login?: unknown; kind?: unknown } | null | undefined,
): boolean {
  // GraphQL names a bot by its login without the [bot] suffix, and a user can't be a Bot.
  return author?.kind === "Bot" && `${String(author.login)}[bot]` === THREAD_AUTHOR;
}
