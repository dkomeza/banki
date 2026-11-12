import { describe, expect, test } from "vitest";
import { closedFormulas } from "./streaming-text";

describe("closedFormulas", () => {
  test("keeps a text whose Formulas are all closed", () => {
    for (const text of ["", "No math.", "At $x = 1$ and $$\\int_0^x f$$ then.", "It costs \\$5."]) {
      expect(closedFormulas(text)).toBe(text);
    }
  });

  test("leaves out a display Formula still open, to the end", () => {
    expect(closedFormulas("so integrate:\n\n$$\\int_0^x \\frac{d")).toBe("so integrate:");
    expect(closedFormulas("$$a$$ then $$b")).toBe("$$a$$ then");
  });

  test("leaves out an inline Formula still open", () => {
    expect(closedFormulas("At $x = 1$ the signs $\\sum")).toBe("At $x = 1$ the signs");
    expect(closedFormulas("At $x = 1$ the signs $")).toBe("At $x = 1$ the signs");
  });

  test("an escaped dollar opens nothing", () => {
    expect(closedFormulas("It costs \\$5 and $x")).toBe("It costs \\$5 and");
  });
});
