import { describe, expect, test } from "bun:test";
import { closingComment, closingsOf, type Comment, MAINTAINER, resultIn } from "./closing";
import { parseResult } from "./result";

// The closing comment: written from a Stage's result, and read back as the
// Dispatcher's memory of what already ran.

const RUNNER = "runner-app-id";
const done = {
  stage: "implement",
  issue: "BAN-7",
  outcome: "done",
  summary: "Opened PR #12. The review rounds come next.",
  nextStatus: "In Review",
  question: null,
  pr: 12,
  headSha: "4f1c0de",
  pushed: true,
  roundsEnded: null,
  routes: [],
  variants: [],
  somethingElse: { kept: true },
};
const stopped = {
  ...done,
  stage: "review-round",
  outcome: "stopped",
  summary: "Triaged 3 findings; fixed 2.",
  question: "The gate fails on a major I dismissed. Override it?",
  options: ["Override it with the admin bypass", "Fix it after all"],
  keptCommits: [{ sha: "0123456789abcdef", worktree: "/work/banki-worktrees/ban-7-x" }],
};

const comment = (fields: Partial<Comment> & { id: string; body: string }): Comment => ({
  createdAt: "2026-10-24T01:00:00.000Z",
  userId: RUNNER,
  parentId: null,
  ...fields,
});

describe("the closing comment", () => {
  test("says what the Stage did and where the issue is, and holds the whole result", () => {
    const body = closingComment(parseResult(done), done);

    expect(body).toStartWith("**Implement Stage: done.** The issue is In Review.");
    expect(body).toContain("Opened PR #12. The review rounds come next.");
    expect(body).toContain("+++ Stage result");
    expect(resultIn(body)).toEqual(parseResult(done));
  });

  test("on a stop, asks the question with the options, recommended first, and names the kept commits", () => {
    const body = closingComment(parseResult(stopped), stopped);

    expect(body).toContain("stopped on @dkomeza");
    expect(body).toContain("**Question:** The gate fails on a major I dismissed. Override it?");
    expect(body).toContain(
      "1. Override it with the admin bypass (recommended)\n2. Fix it after all",
    );
    expect(body).toContain("`0123456` in `/work/banki-worktrees/ban-7-x`");
    expect(body).toContain("Reply in this comment's thread");
  });

  test("carries a log's tail when there is one", () => {
    const body = closingComment(parseResult(stopped), stopped, [
      "01:02:03 tool: Bash ls",
      "end: error",
    ]);

    expect(body).toContain("```\n01:02:03 tool: Bash ls\nend: error\n```");
  });

  test("keeps the result readable even with the fields a Stage adds", () => {
    expect(resultIn(closingComment(parseResult(done), done))?.pr).toBe(12);
  });

  test("reads no result from a comment without the section, or with JSON it can't read", () => {
    expect(resultIn("Just a comment")).toBeUndefined();
    expect(resultIn("+++ Stage result\n\n```json\n{ not json\n```\n\n+++")).toBeUndefined();
    expect(resultIn('+++ Stage result\n\n```json\n{"stage": "lunch"}\n```\n\n+++')).toBeUndefined();
  });
});

describe("reading the closing comments back", () => {
  const body = closingComment(parseResult(stopped), stopped);

  test("takes top-level comments by the Runner app or the Maintainer, oldest first", () => {
    const closings = closingsOf(
      [
        comment({
          id: "b",
          body,
          createdAt: "2026-10-24T03:00:00.000Z",
          userId: MAINTAINER.linearId,
        }),
        comment({ id: "a", body }),
      ],
      { runner: RUNNER, issue: "BAN-7" },
    );

    expect(closings.map((closing) => closing.id)).toEqual(["a", "b"]);
    expect(closings[0]?.result.outcome).toBe("stopped");
  });

  test("ignores anyone else's comment, a reply, and another issue's result", () => {
    const other = { ...done, issue: "BAN-8" };
    const closings = closingsOf(
      [
        comment({ id: "x", body, userId: "someone-else" }),
        comment({ id: "y", body, parentId: "a" }),
        comment({ id: "z", body: closingComment(parseResult(other), other) }),
      ],
      { runner: RUNNER, issue: "BAN-7" },
    );

    expect(closings).toEqual([]);
  });

  test("gathers the Maintainer's replies in its thread, and only theirs", () => {
    const [closing] = closingsOf(
      [
        comment({ id: "a", body }),
        comment({
          id: "r1",
          body: "Override it.",
          parentId: "a",
          userId: MAINTAINER.linearId,
          createdAt: "2026-10-24T09:00:00.000Z",
        }),
        comment({
          id: "r2",
          body: "Do it now",
          parentId: "a",
          userId: "someone-else",
          createdAt: "2026-10-24T09:01:00.000Z",
        }),
        comment({
          id: "r3",
          body: "Me too",
          parentId: "a",
          userId: RUNNER,
          createdAt: "2026-10-24T09:02:00.000Z",
        }),
      ],
      { runner: RUNNER, issue: "BAN-7" },
    );

    expect(closing?.replies.map((reply) => reply.id)).toEqual(["r1"]);
  });
});
