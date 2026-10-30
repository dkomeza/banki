import { describe, expect, test } from "vitest";
import {
  checkRow,
  type MacroRow,
  macrosSaveErrorText,
  rowsFor,
  sameMacros,
  sampleOf,
  savedMacros,
} from "./macros";

let n = 0;
const row = (name: string, definition: string): MacroRow => ({
  name,
  definition,
  id: `r${(n += 1)}`,
});

/** The checks of the row at `index` of `rows`, typeset on top of `under`. */
const check = (
  rows: MacroRow[],
  index = 0,
  under: readonly { name: string; definition: string }[] = [],
) => {
  const r = rows[index];
  if (r === undefined) throw new Error("No such row");
  return checkRow(r, rows, under);
};

describe("checkRow", () => {
  test("saves a Macro that is written and typesets, with its render and arguments", () => {
    const checked = check([row("\\norm", "\\left\\| #1 \\right\\|")]);

    expect(checked).toMatchObject({ saved: true, arity: 1, sample: "\\norm{x}" });
    expect(checked.html).toContain("katex");
    expect(checked.nameError).toBeUndefined();
    expect(checked.definitionError).toBeUndefined();
  });

  test("a new row is still being written, not a problem, until it has a name and a definition", () => {
    expect(check([row("\\", "")])).toMatchObject({ saved: false, incomplete: true });
    expect(check([row("\\R", " ")])).toMatchObject({ saved: false, incomplete: true });
    expect(check([row("\\", "\\mathbb{R}")])).toMatchObject({ saved: false, incomplete: true });
    expect(check([row("\\R", "")]).nameError).toBeUndefined();
  });

  test("says what is wrong with a bad name", () => {
    expect(check([row("R", "x")]).nameError).toBe("A name starts with \\, such as \\R.");
    expect(check([row("\\R1", "x")]).nameError).toBe(
      "A name is \\ and letters, such as \\R, or \\ and one other character.",
    );
    expect(check([row("\\R1", "x")]).saved).toBe(false);
  });

  test("refuses a name already in its list, the later row", () => {
    const rows = [row("\\d", "\\mathrm{d}"), row("\\d", "\\,\\mathrm{d}")];

    expect(check(rows, 0).saved).toBe(true);
    expect(check(rows, 1).nameError).toBe("\\d is already in this list.");
  });

  test("gives KaTeX's message for a definition it can't typeset with sample arguments", () => {
    const checked = check([row("\\half", "\\frac{1}{2")]);

    expect(checked.saved).toBe(false);
    expect(checked.definitionError).toContain("Unexpected end of input");
  });

  test("refuses a definition over 1,000 characters", () => {
    expect(check([row("\\R", "x".repeat(1001))]).definitionError).toBe(
      "Up to 1,000 characters: this is 1,001.",
    );
    expect(check([row("\\R", "x".repeat(1000))]).saved).toBe(true);
  });

  test("refuses a row past the 100th", () => {
    const rows = Array.from({ length: 101 }, (_, i) => row(`\\m${"a".repeat(i + 1)}`, "x"));

    expect(check(rows, 99).saved).toBe(true);
    expect(check(rows, 100).nameError).toBe("A list holds up to 100 macros.");
  });

  test("notes a name KaTeX already knows, and saves it", () => {
    expect(check([row("\\R", "\\mathbf{R}")])).toMatchObject({ saved: true, replaces: "\\R" });
    expect(check([row("\\frac", "#1/#2")])).toMatchObject({ saved: true, replaces: "\\frac" });
    expect(check([row("\\norm", "x")]).replaces).toBeUndefined();
  });

  test("typesets on top of the list's other Macros and those it is under", () => {
    const rows = [row("\\nR", "\\norm{\\R}"), row("\\R", "\\mathbb{R}")];
    const under = [{ name: "\\norm", definition: "\\left\\| #1 \\right\\|" }];

    expect(check(rows, 0, under).saved).toBe(true);
    expect(check(rows, 0).definitionError).toContain("\\norm");
  });
});

describe("savedMacros", () => {
  test("is the rows that are written and have no problem, in order", () => {
    const rows = [
      row("\\norm", "\\left\\| #1 \\right\\|"),
      row("\\", ""),
      row("\\bad", "\\frac{"),
      row("\\eps", "\\varepsilon"),
    ];

    expect(savedMacros(rows, [])).toEqual([
      { name: "\\norm", definition: "\\left\\| #1 \\right\\|" },
      { name: "\\eps", definition: "\\varepsilon" },
    ]);
  });
});

describe("rowsFor", () => {
  test("keeps the ID of each row whose name is still there", () => {
    const before = [row("\\a", "x"), row("\\b", "y")];
    const after = rowsFor(
      [
        { name: "\\b", definition: "z" },
        { name: "\\c", definition: "w" },
      ],
      before,
    );

    expect(after[0]).toEqual({ name: "\\b", definition: "z", id: before[1]?.id });
    expect(after[1]?.id).not.toBe(before[0]?.id);
  });
});

describe("sampleOf and sameMacros", () => {
  test("write a name with one sample argument each", () => {
    expect(sampleOf("\\R", 0)).toBe("\\R");
    expect(sampleOf("\\inner", 2)).toBe("\\inner{x}{y}");
  });

  test("compare lists by their Macros, in order", () => {
    const a = [{ name: "\\a", definition: "x" }];

    expect(sameMacros(a, [{ name: "\\a", definition: "x" }])).toBe(true);
    expect(sameMacros(a, [{ name: "\\a", definition: "y" }])).toBe(false);
  });
});

describe("macrosSaveErrorText", () => {
  const abs = { name: "\\abs", definition: "\\left| #1 \\right|" };
  const eps = { name: "\\eps", definition: "\\varepsilon" };

  test("names a rename, and what the row is back to", () => {
    expect(macrosSaveErrorText([{ ...abs, name: "\\absval" }, eps], [abs, eps])).toBe(
      "Couldn't save \\absval, so the row is back to \\abs.",
    );
  });

  test("names a Macro added, deleted or changed", () => {
    expect(macrosSaveErrorText([abs, eps], [abs])).toBe(
      "Couldn't save \\eps, so it isn't in the list.",
    );
    expect(macrosSaveErrorText([abs], [abs, eps])).toBe(
      "Couldn't save deleting \\eps, so it's back in the list.",
    );
    expect(macrosSaveErrorText([abs, { ...eps, definition: "\\epsilon" }], [abs, eps])).toBe(
      "Couldn't save the change to \\eps, so it's back as it was.",
    );
  });

  test("speaks of the list for anything else", () => {
    expect(macrosSaveErrorText([], [abs, eps])).toBe(
      "Couldn't save the macros, so they're back as they were.",
    );
  });
});
