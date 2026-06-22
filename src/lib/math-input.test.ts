import { describe, expect, it } from "vitest";
import { insertMathTemplate } from "@/lib/math-input";

describe("math input templates", () => {
  it("wraps selected text and places the cursor inside the expression", () => {
    expect(insertMathTemplate("Use x here", 4, 5, "\\({selection}{cursor}\\)")).toEqual({
      value: "Use \\(x\\) here",
      selectionStart: 7,
      selectionEnd: 7,
    });
  });

  it("inserts a template at the caret", () => {
    expect(insertMathTemplate("Answer: ", 8, 8, "\\sqrt{{selection}{cursor}}")).toEqual({
      value: "Answer: \\sqrt{}",
      selectionStart: 14,
      selectionEnd: 14,
    });
  });
});
