import type { StageKind } from "../cli/args";
import { parseResult, type StageResult } from "./result";

// The closing comment, the Dispatcher's memory (ADR-0013): each Stage ends
// with a top-level comment on its issue holding its summary and its whole
// result, as JSON in a collapsed section. Headless the Dispatcher posts it,
// live `/work-issue` does, and the Dispatcher's own stops (a wait that
// failed, a timeout, a crash, a state that fits no Stage) use the same
// format. What already ran on an issue is read back from these comments
// alone, by the Runner app or the Maintainer. Pure, so it is unit-tested.

export const MAINTAINER = { linearId: "42d28a14-d696-4894-8aa0-0ab65e5177f2", handle: "dkomeza" };

/** A Linear comment, as the Dispatcher reads it. */
export type Comment = {
  id: string;
  body: string;
  createdAt: string;
  userId: string | null;
  parentId: string | null;
};

export type Closing = {
  id: string;
  at: string;
  result: StageResult;
  /** The Maintainer's replies in its thread, oldest first. */
  replies: Comment[];
};

const SECTION = "+++ Stage result";

export const TITLES: Record<StageKind, string> = {
  design: "Design",
  implement: "Implement",
  "review-round": "Review round",
  "acceptance-fix": "Acceptance fix",
};

/**
 * The closing comment for a result: what the Stage did and what comes next,
 * a stop's question and options, and the whole result (`json`, as written).
 * `tail` is a log's last lines, for a stop the Dispatcher makes after a crash
 * or a timeout.
 */
export function closingComment(
  result: StageResult,
  json: Record<string, unknown>,
  tail: readonly string[] = [],
): string {
  const title = TITLES[result.stage];
  const parts: string[] = [];
  if (result.outcome === "done") {
    parts.push(`**${title} Stage: done.** The issue is ${result.nextStatus}.`);
  } else {
    parts.push(`**${title} Stage: stopped on @${MAINTAINER.handle}.**`);
    if (result.question !== null) parts.push(`**Question:** ${result.question}`);
    if (result.options.length > 0) {
      parts.push(
        result.options
          .map((option, i) => `${i + 1}. ${option}${i === 0 ? " (recommended)" : ""}`)
          .join("\n"),
      );
    }
  }
  if (result.summary.trim() !== "") parts.push(result.summary.trim());
  if (result.keptCommits.length > 0) {
    parts.push(
      `Local commits it kept, on the Runner and not pushed: ${result.keptCommits
        .map((kept) => `\`${kept.sha.slice(0, 7)}\` in \`${kept.worktree}\``)
        .join(", ")}.`,
    );
  }
  if (tail.length > 0) {
    parts.push(`The log's last ${tail.length} events:\n\n\`\`\`\n${tail.join("\n")}\n\`\`\``);
  }
  if (result.outcome === "stopped") {
    parts.push("Reply in this comment's thread to hand the issue back.");
  }
  parts.push(`${SECTION}\n\n\`\`\`json\n${JSON.stringify(json, null, 2)}\n\`\`\`\n\n+++`);
  return parts.join("\n\n");
}

/** The result a closing comment holds, or undefined when it holds none it can read. */
export function resultIn(body: string): StageResult | undefined {
  const lines = body.split("\n");
  const start = lines.findIndex((line) => line.trim() === SECTION);
  if (start === -1) return undefined;
  const length = lines.slice(start + 1).findIndex((line) => line.trim() === "+++");
  if (length === -1) return undefined;
  const inside = lines
    .slice(start + 1, start + 1 + length)
    .filter((line) => !/^\s*```/.test(line))
    .join("\n");
  try {
    return parseResult(JSON.parse(inside));
  } catch {
    return undefined;
  }
}

/**
 * The issue's closing comments, oldest first: top-level, by the Runner app
 * or the Maintainer, holding a result for this issue. Every other comment is
 * data, never input.
 */
export function closingsOf(
  comments: readonly Comment[],
  ids: { runner: string; issue: string },
): Closing[] {
  const trusted = (comment: Comment) =>
    comment.userId === ids.runner || comment.userId === MAINTAINER.linearId;
  return comments
    .filter((comment) => comment.parentId === null && trusted(comment))
    .flatMap((comment) => {
      const result = resultIn(comment.body);
      if (result === undefined || result.issue.toUpperCase() !== ids.issue.toUpperCase()) return [];
      const replies = comments
        .filter(
          (reply) =>
            reply.parentId === comment.id &&
            reply.userId === MAINTAINER.linearId &&
            reply.createdAt > comment.createdAt,
        )
        .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt));
      return [{ id: comment.id, at: comment.createdAt, result, replies }];
    })
    .toSorted((a, b) => a.at.localeCompare(b.at));
}
