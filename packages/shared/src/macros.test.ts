import { describe, expect, test } from "bun:test";
import {
  effectiveMacros,
  expandMacros,
  type Macro,
  MACRO_DEFINITION_MAX_LENGTH,
  macroArity,
  MacroList,
  MACROS_MAX,
} from "./macros";

const m = (name: string, definition: string): Macro => ({ name, definition });

/** The first problem `MacroList` finds in `macros`, or null. */
function problem(macros: unknown): string | null {
  const parsed = MacroList.safeParse(macros);
  return parsed.success ? null : (parsed.error.issues[0]?.message ?? "?");
}

/** `n` Macros, each with a name of its own. */
const many = (n: number) => Array.from({ length: n }, (_, i) => m(`\\m${"a".repeat(i + 1)}`, "x"));

describe("MacroList", () => {
  test("takes an empty list and a list of good Macros", () => {
    expect(problem([])).toBeNull();
    expect(problem([m("\\R", "\\mathbb{R}"), m("\\norm", "\\left\\| #1 \\right\\|")])).toBeNull();
    expect(problem([m("\\;", "\\,")])).toBeNull();
  });

  test("refuses a bad name, naming it", () => {
    for (const name of ["R", "\\", "\\ab1", "\\12", "\\R\\S", ""]) {
      expect(problem([m(name, "x")])).toContain("name");
    }
  });

  test("refuses a blank definition", () => {
    expect(problem([m("\\R", " ")])).toBe("Write what the macro stands for");
  });

  test(`takes a definition of ${MACRO_DEFINITION_MAX_LENGTH} characters and refuses one more`, () => {
    expect(problem([m("\\R", "x".repeat(MACRO_DEFINITION_MAX_LENGTH))])).toBeNull();
    expect(problem([m("\\R", "x".repeat(MACRO_DEFINITION_MAX_LENGTH + 1))])).toBe(
      "Keep \\R's definition to 1,000 characters",
    );
  });

  test("refuses a name twice in one list", () => {
    expect(problem([m("\\R", "x"), m("\\R", "y")])).toBe("\\R is in the list twice");
  });

  test(`takes ${MACROS_MAX} Macros and refuses ${MACROS_MAX + 1}`, () => {
    expect(problem(many(MACROS_MAX))).toBeNull();
    expect(problem(many(MACROS_MAX + 1))).toBe("Keep to 100 macros");
  });

  test("refuses a Macro with other keys, or one that isn't an object", () => {
    expect(problem([{ name: "\\R", definition: "x", extra: 1 }])).not.toBeNull();
    expect(problem(["\\R"])).not.toBeNull();
  });
});

describe("macroArity", () => {
  test("is the highest #n in the definition", () => {
    expect(macroArity("\\mathbb{R}")).toBe(0);
    expect(macroArity("\\left\\| #1 \\right\\|")).toBe(1);
    expect(macroArity("\\langle #2, #1 \\rangle")).toBe(2);
    expect(macroArity("#3")).toBe(3);
  });

  test("doesn't count ## as an argument", () => {
    expect(macroArity("##1")).toBe(0);
  });
});

describe("effectiveMacros", () => {
  test("is Settings' Macros with the Deck's own on top, per name", () => {
    const settings = [m("\\norm", "N"), m("\\eps", "\\varepsilon")];
    const deck = [m("\\eps", "\\epsilon"), m("\\d", "\\mathrm{d}")];
    expect(effectiveMacros(settings, deck)).toEqual([
      m("\\norm", "N"),
      m("\\eps", "\\epsilon"),
      m("\\d", "\\mathrm{d}"),
    ]);
  });

  test("is Settings' alone for a Deck with none of its own", () => {
    expect(effectiveMacros([m("\\R", "x")], [])).toEqual([m("\\R", "x")]);
  });
});

describe("expandMacros", () => {
  const macros = [
    m("\\R", "\\mathbb{R}"),
    m("\\eps", "\\varepsilon"),
    m("\\norm", "\\left\\| #1 \\right\\|"),
    m("\\pair", "(#1, #2)"),
  ];

  test("replaces a Macro inside a Formula", () => {
    expect(expandMacros("Let $x \\in \\R$.", macros)).toBe("Let $x \\in \\mathbb{R}$.");
    expect(expandMacros("$$\\R$$", macros)).toBe("$$\\mathbb{R}$$");
    expect(expandMacros("$$\n\\R\n$$", macros)).toBe("$$\n\\mathbb{R}\n$$");
  });

  test("leaves text, code and \\$ untouched", () => {
    expect(expandMacros("\\R is the reals", macros)).toBe("\\R is the reals");
    expect(expandMacros("`$\\R$` and $\\R$", macros)).toBe("`$\\R$` and $\\mathbb{R}$");
    expect(expandMacros("```\n$\\R$\n```", macros)).toBe("```\n$\\R$\n```");
    expect(expandMacros("\\$\\R\\$", macros)).toBe("\\$\\R\\$");
  });

  test("reads a brace group as an argument, dropping its braces", () => {
    expect(expandMacros("$\\norm{x + y}$", macros)).toBe("$\\left\\| x + y \\right\\|$");
    expect(expandMacros("$\\norm{\\frac{a}{b}}$", macros)).toBe(
      "$\\left\\| \\frac{a}{b} \\right\\|$",
    );
  });

  test("reads a single token as an argument", () => {
    expect(expandMacros("$\\norm x$", macros)).toBe("$\\left\\| x \\right\\|$");
    expect(expandMacros("$\\norm\\alpha$", macros)).toBe("$\\left\\| \\alpha \\right\\|$");
    expect(expandMacros("$\\pair ab$", macros)).toBe("$(a, b)$");
    expect(expandMacros("$\\pair{a}{b}$", macros)).toBe("$(a, b)$");
  });

  test("leaves a Macro with a missing argument as written", () => {
    expect(expandMacros("$\\norm$", macros)).toBe("$\\norm$");
    expect(expandMacros("${\\norm}$", macros)).toBe("${\\norm}$");
    expect(expandMacros("$\\pair{a}$ and $\\R$", macros)).toBe("$\\pair{a}$ and $\\mathbb{R}$");
    expect(expandMacros("$\\norm{x$", macros)).toBe("$\\norm{x$");
  });

  test("expands Macros inside other Macros, and inside arguments", () => {
    const nested = [...macros, m("\\nR", "\\norm{\\R}")];
    expect(expandMacros("$\\nR$", nested)).toBe("$\\left\\| \\mathbb{R} \\right\\|$");
    expect(expandMacros("$\\norm{\\eps}$", macros)).toBe("$\\left\\| \\varepsilon \\right\\|$");
  });

  test("leaves a Formula that passes the expansion limit as written, and the others expanded", () => {
    const looping = [...macros, m("\\loop", "\\loop x")];
    expect(expandMacros("$\\loop$ and $\\R$", looping)).toBe("$\\loop$ and $\\mathbb{R}$");
    // Each level doubles: ten levels take 1,023 expansions, nine take 511.
    const levels = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
    const doubling = levels.map((name, i) =>
      m(`\\${name}`, i === levels.length - 1 ? "z" : `\\${levels[i + 1]}\\${levels[i + 1]}`),
    );
    expect(expandMacros("$\\a$", doubling)).toBe("$\\a$");
    expect(expandMacros("$\\b$", doubling)).toBe(`$${"z".repeat(256)}$`);
  });

  test("keeps a control word from running into a letter after it", () => {
    expect(expandMacros("$\\R x$", macros)).toBe("$\\mathbb{R} x$");
    expect(expandMacros("$\\eps n$", macros)).toBe("$\\varepsilon n$");
    expect(expandMacros("$\\eps{}n$", macros)).toBe("$\\varepsilon{}n$");
    const toWord = [m("\\x", "\\alpha"), m("\\y", "b")];
    expect(expandMacros("$\\x\\y$", toWord)).toBe("$\\alpha b$");
    expect(expandMacros("$\\x1$", toWord)).toBe("$\\alpha1$");
  });

  test("leaves a Formula's own \\def and \\newcommand names alone inside it", () => {
    expect(expandMacros("$\\def\\R{S} \\R$ and $\\R$", macros)).toBe(
      "$\\def\\R{S} \\R$ and $\\mathbb{R}$",
    );
    expect(expandMacros("$\\newcommand{\\R}{S} \\R + \\eps$", macros)).toBe(
      "$\\newcommand{\\R}{S} \\R + \\varepsilon$",
    );
    expect(expandMacros("$\\renewcommand\\eps{e}\\eps$", macros)).toBe(
      "$\\renewcommand\\eps{e}\\eps$",
    );
  });

  test("puts arguments in for #1 to #9, and # for ##", () => {
    expect(expandMacros("$\\swap ab$", [m("\\swap", "#2#1")])).toBe("$ba$");
    expect(expandMacros("$\\h$", [m("\\h", "\\#a##")])).toBe("$\\#a#$");
  });

  test("leaves a comment as written", () => {
    expect(expandMacros("$$\\R % \\R\n$$", macros)).toBe("$$\\mathbb{R} % \\R\n$$");
  });

  test("changes nothing without Macros", () => {
    expect(expandMacros("$\\R$", [])).toBe("$\\R$");
  });
});
