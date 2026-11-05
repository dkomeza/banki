import { describe, expect, test } from "bun:test";
import { expandMacrosMapped, type Macro, unmapped } from "@banki/shared";
import { highlightRange } from "./highlights";

const macros: Macro[] = [{ name: "\\R", definition: "\\mathbb{R}" }];

/** The part of `stored` a Highlight on `sent` points at, or undefined when it is dropped. */
function pointedAt(stored: string, line: number, quote: string, list = macros) {
  const range = highlightRange(expandMacrosMapped(stored, list), { line, quote });
  return range === undefined ? undefined : stored.slice(range.from, range.to);
}

describe("highlightRange", () => {
  test("maps a quote on its line to its range", () => {
    expect(pointedAt("First line\nthe derivative is 2x", 2, "2x")).toBe("2x");
    const range = highlightRange(unmapped("a\nb c"), { line: 2, quote: "c" });
    expect(range).toEqual({ from: 4, to: 5 });
  });

  test("ignores whitespace around the quote", () => {
    expect(pointedAt("x = 2", 1, "  2 ")).toBe("2");
  });

  test("maps a quote inside a Macro's expansion back to the text as written", () => {
    expect(pointedAt("so $x \\in \\R^n$ holds", 1, "x \\in \\mathbb{R}^n")).toBe("x \\in \\R^n");
  });

  test("widens a quote over part of a Macro's expansion to the whole Macro", () => {
    expect(pointedAt("so $x \\in \\R$", 1, "mathbb")).toBe("\\R");
    expect(pointedAt("so $x \\in \\R$", 1, "\\in \\mathbb")).toBe("\\in \\R");
  });

  test("maps a quote that isn't on its line to the whole line", () => {
    expect(pointedAt("one\n  two three  \nfour", 2, "five")).toBe("two three");
    expect(pointedAt("one\ntwo", 2, "one")).toBe("two");
    expect(pointedAt("one\ntwo", 2, "")).toBe("two");
  });

  test("maps a repeated phrase to the one on the named line", () => {
    const stored = "x + 1\nx + 1\nx + 1";
    const range = highlightRange(unmapped(stored), { line: 2, quote: "x + 1" });
    expect(range).toEqual({ from: 6, to: 11 });
  });

  test("drops a Highlight on a line that isn't there", () => {
    expect(pointedAt("one\ntwo", 3, "two")).toBeUndefined();
    expect(pointedAt("one\ntwo", 0, "one")).toBeUndefined();
    expect(pointedAt("one\ntwo", 1.5, "one")).toBeUndefined();
  });

  test("drops a Highlight on a blank line it doesn't find its quote on", () => {
    expect(pointedAt("one\n   \ntwo", 2, "one")).toBeUndefined();
  });

  test("counts lines after Windows line breaks the same", () => {
    expect(pointedAt("one\r\ntwo three\r\n", 2, "missing")).toBe("two three");
  });
});
