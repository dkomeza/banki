import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isRecord } from "./lib/parse";

// The merge gate runs for the Runner's App (ADR-0012): claude-code-action
// refuses a bot's push unless `allowed_bots` names it. Read from
// .github/workflows the way GitHub reads it.

const WORKFLOW_PATH = join(
  import.meta.dir,
  "..",
  "..",
  ".github",
  "workflows",
  "claude-review.yml",
);

const parsed: unknown = Bun.YAML.parse(readFileSync(WORKFLOW_PATH, "utf8"));

function reviewStep(): Record<string, unknown> {
  if (!isRecord(parsed) || !isRecord(parsed.jobs)) throw new Error("claude-review.yml: no jobs");
  const job = parsed.jobs["claude-review"];
  if (!isRecord(job) || !Array.isArray(job.steps)) throw new Error("no claude-review job");
  const step: unknown = job.steps.find(
    (candidate: unknown) =>
      isRecord(candidate) &&
      typeof candidate.uses === "string" &&
      candidate.uses.startsWith("anthropics/claude-code-action@"),
  );
  if (!isRecord(step) || !isRecord(step.with)) throw new Error("no claude-code-action step");
  return step.with;
}

describe("claude-review", () => {
  test("allows the Runner's App, and no other bot", () => {
    expect(reviewStep().allowed_bots).toBe("banki-runner");
  });

  // An approval from the workflow's token would count as the merge guard's
  // one required approval, which is the Maintainer's alone.
  test("requests changes, and never approves", () => {
    const source = readFileSync(WORKFLOW_PATH, "utf8");
    expect(source).toContain("event=REQUEST_CHANGES");
    expect(source).not.toMatch(/event=APPROVE/);
  });
});
