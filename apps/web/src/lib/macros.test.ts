import { describe, expect, test } from "vitest";
import {
  checkRow,
  type MacroRow,
  keptOf,
  macrosSaveErrorText,
  reconcile,
  rowsFor,
  sameMacros,
  sampleOf,
  toSave,
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

  test("a row renamed to a saved Macro's name is the repeat, not that Macro", () => {
    const rows = [
      { ...row("\\eps", "\\left\\| #1 \\right\\|"), kept: { name: "\\norm", definition: "x" } },
      { ...row("\\eps", "\\varepsilon"), kept: { name: "\\eps", definition: "\\varepsilon" } },
    ];

    expect(check(rows, 0).nameError).toBe("\\eps is already in this list.");
    expect(check(rows, 1).saved).toBe(true);
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

const norm = { name: "\\norm", definition: "\\left\\| #1 \\right\\|" };
const eps = { name: "\\eps", definition: "\\varepsilon" };
const abs = { name: "\\abs", definition: "\\left| #1 \\right|" };

/** `rows` with the row named `name` changed by `edit`. */
const edit = (rows: MacroRow[], name: string, change: Partial<MacroRow>) =>
  rows.map((r) => (r.name === name ? { ...r, ...change } : r));

describe("toSave", () => {
  test("saves the rows that are written and have no problem, in order", () => {
    const rows = [...rowsFor([norm]), row("\\", ""), row("\\bad", "\\frac{"), ...rowsFor([eps])];

    expect(toSave(rows, []).list).toEqual([norm, eps]);
  });

  test("keeps a saved Macro as it was while its row has a problem", () => {
    const rows = rowsFor([norm, eps]);

    expect(toSave(edit(rows, "\\norm", { definition: "\\left\\| #1 \\right" }), []).list).toEqual([
      norm,
      eps,
    ]);
    expect(toSave(edit(rows, "\\norm", { name: "\\eps" }), []).list).toEqual([norm, eps]);
    expect(toSave(edit(rows, "\\norm", { name: "\\no rm" }), []).list).toEqual([norm, eps]);
  });

  test("a renamed or changed row saves as it is now", () => {
    const rows = rowsFor([norm, eps]);
    const { rows: next, list } = toSave(edit(rows, "\\eps", { definition: "\\epsilon" }), []);

    expect(list).toEqual([norm, { ...eps, definition: "\\epsilon" }]);
    expect(keptOf(next)).toEqual(list);
  });
});

describe("reconcile", () => {
  test("a failed rename puts the row back, keeping it (and so its form) open", () => {
    const rows = rowsFor([norm, abs, eps]);
    const sent = toSave(edit(rows, "\\abs", { name: "\\absval" }), []).rows;

    const back = reconcile(sent, [norm, abs, eps]);

    expect(back.map((r) => r.id)).toEqual(rows.map((r) => r.id));
    expect(back[1]).toMatchObject({ ...abs, kept: abs });
  });

  test("a failed deletion brings the Macro back where it stood", () => {
    const rows = rowsFor([norm, abs, eps]);
    const sent = toSave(
      rows.filter((r) => r.name !== "\\abs"),
      [],
    ).rows;

    expect(reconcile(sent, [norm, abs, eps]).map((r) => r.name)).toEqual([
      "\\norm",
      "\\abs",
      "\\eps",
    ]);
  });

  test("a failed addition stays, unsaved, as does a row being written", () => {
    const rows = [...rowsFor([norm]), row("\\half", "\\frac{1}{2")];
    const added = toSave([...rows, row("\\grad", "\\nabla #1")], []).rows;

    const back = reconcile(added, [norm]);

    expect(back.map((r) => r.name)).toEqual(["\\norm", "\\half", "\\grad"]);
    expect(back[2]?.kept).toBeUndefined();
    expect(keptOf(back)).toEqual([norm]);
  });

  test("a change from elsewhere shows in its row, leaving the one being written alone", () => {
    const rows = [...rowsFor([norm, eps]), row("\\", "")];

    const back = reconcile(rows, [norm, { ...eps, definition: "\\epsilon" }]);

    expect(back.map((r) => r.id)).toEqual(rows.map((r) => r.id));
    expect(back[1]?.definition).toBe("\\epsilon");
    expect(back[2]).toEqual(rows[2]);
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
  test("names a rename, and what the row is back to", () => {
    expect(macrosSaveErrorText([{ ...abs, name: "\\absval" }, eps], [abs, eps])).toBe(
      "Couldn't save \\absval, so the row is back to \\abs.",
    );
  });

  test("names a Macro added, deleted or changed", () => {
    expect(macrosSaveErrorText([abs, eps], [abs])).toBe(
      "Couldn't save \\eps. Try again to save it.",
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
