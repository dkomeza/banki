import { describe, expect, test } from "bun:test";
import { badNextStatus } from "./statuses";

// Where a Stage's result may send its issue, as references/stages.md's table has it.

describe("a result's next status", () => {
  test.each([
    ["design", "done", "In Design"],
    ["implement", "done", "In Review"],
    ["review-round", "done", "In Review"],
    ["acceptance-fix", "done", "In Review"],
    ["design", "stopped", "In Design"],
    ["implement", "stopped", "Todo"],
    ["review-round", "stopped", "In Review"],
    ["acceptance-fix", "stopped", "In Review"],
  ] as const)("is %s %s: %s", (stage, outcome, nextStatus) => {
    expect(badNextStatus({ stage, outcome, nextStatus })).toBeUndefined();
  });

  test("is refused anywhere else, saying where it should be", () => {
    expect(
      badNextStatus({ stage: "review-round", outcome: "done", nextStatus: "Acceptance" }),
    ).toContain("leaves the issue in In Review");
    expect(
      badNextStatus({ stage: "implement", outcome: "done", nextStatus: "Done" }),
    ).toBeDefined();
    expect(
      badNextStatus({ stage: "implement", outcome: "stopped", nextStatus: "In Review" }),
    ).toBeDefined();
    expect(
      badNextStatus({ stage: "design", outcome: "done", nextStatus: "Design Review" }),
    ).toBeDefined();
  });
});
