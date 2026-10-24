import { describe, expect, test } from "bun:test";
import { parseSummary, startedByClaudeReview } from "./review";

// claude-review's summary comment and its threads, as GitHub returns them.

/** A summary as the workflow's "Report and gate" step writes it. */
const SUMMARY = [
  "<!-- claude-review -->",
  "## Claude review: ❌ 1 blocking finding(s) open",
  "",
  "At `4f1c0de`. Two findings, one of them blocking.",
  "",
  "| Status | Severity | Where | Finding |",
  "| --- | --- | --- | --- |",
  "| new | major | `apps/api/src/a.ts:12` | The query isn't scoped by User \\| ever |",
  "| fixed | minor | `apps/web/src/b.tsx:3` | Unused import |",
].join("\n");

describe("the summary comment", () => {
  test("gives the commit it is at and each finding's status and severity", () => {
    expect(parseSummary(SUMMARY)).toEqual({
      sha: "4f1c0de",
      findings: [
        { status: "new", severity: "major" },
        { status: "fixed", severity: "minor" },
      ],
    });
  });

  test("with no findings, has none", () => {
    expect(
      parseSummary(
        "<!-- claude-review -->\n## Claude review: ✅ No blocking findings\n\nAt `4f1c0de`. Clean.",
      ),
    ).toEqual({
      sha: "4f1c0de",
      findings: [],
    });
  });

  test("is only a body that starts with the marker", () => {
    expect(parseSummary(`Quoting it:\n${SUMMARY}`)).toBeUndefined();
  });
});

describe("a review thread", () => {
  test("is claude-review's when the Claude GitHub App started it", () => {
    expect(startedByClaudeReview({ login: "claude", kind: "Bot" })).toBe(true);
  });

  test("isn't when a user named like it, or another bot, did", () => {
    expect(startedByClaudeReview({ login: "claude", kind: "User" })).toBe(false);
    expect(startedByClaudeReview({ login: "github-actions", kind: "Bot" })).toBe(false);
    expect(startedByClaudeReview({ login: "chatgpt-codex-connector", kind: "Bot" })).toBe(false);
    expect(startedByClaudeReview(null)).toBe(false);
  });
});
