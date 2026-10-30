import { describe, expect, test } from "bun:test";
import { GradingNotes, UpdateCardRequest } from "./cards";

describe("GradingNotes", () => {
  test("accepts none, 2,000 characters, and text kept exactly as written", () => {
    expect(GradingNotes.parse(null)).toBeNull();
    expect(GradingNotes.parse("a".repeat(2_000))).toBe("a".repeat(2_000));
    expect(GradingNotes.parse("  Must mention $x$.\n")).toBe("  Must mention $x$.\n");
  });

  test("refuses 2,001 characters", () => {
    const result = GradingNotes.safeParse("a".repeat(2_001));
    expect(result.error?.issues.map((issue) => issue.message)).toEqual([
      "Keep grading notes to 2,000 characters",
    ]);
  });

  test.each(["", "   ", "\n\t", " ".repeat(2_001)])("reads %p as none", (notes) => {
    expect(GradingNotes.parse(notes)).toBeNull();
  });

  test("refuses what isn't text or null", () => {
    expect(GradingNotes.safeParse(5).success).toBe(false);
    expect(GradingNotes.safeParse(undefined).success).toBe(false);
  });
});

describe("UpdateCardRequest", () => {
  test("takes grading notes alone, null clearing them", () => {
    expect(UpdateCardRequest.parse({ gradingNotes: "x" })).toEqual({ gradingNotes: "x" });
    expect(UpdateCardRequest.parse({ gradingNotes: null })).toEqual({ gradingNotes: null });
    expect(UpdateCardRequest.parse({ gradingNotes: " " })).toEqual({ gradingNotes: null });
  });

  test("still wants something to change", () => {
    expect(UpdateCardRequest.safeParse({}).success).toBe(false);
  });
});
