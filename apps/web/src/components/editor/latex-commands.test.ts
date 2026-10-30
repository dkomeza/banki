import { describe, expect, test } from "vitest";
import { typeset } from "@/lib/formula";
import { COMMANDS, GROUPS, macroCommands, matching, previewOf, search } from "./latex-commands";

const names = (commands: readonly { name: string }[]) => commands.map(({ name }) => name);

describe("the LaTeX commands", () => {
  test.each(COMMANDS.map((command) => [command.name, command] as const))(
    "KaTeX typesets %s",
    (_name, command) => {
      expect(typeset(previewOf(command), false)).toHaveProperty("html");
      // What is inserted typesets too, once its slots are filled.
      const filler = command.name === "\\hspace" ? "1em" : "x";
      expect(typeset(command.snippet.replaceAll("▯", filler), false)).toHaveProperty("html");
    },
  );

  test("each name is listed once", () => {
    expect(new Set(names(COMMANDS)).size).toBe(COMMANDS.length);
  });

  test("cover every group the spec names", () => {
    expect(new Set(COMMANDS.map(({ group }) => group))).toEqual(new Set(GROUPS));
    for (const name of ["\\alpha", "\\frac", "\\leq", "\\to", "\\hat", "\\left(", "\\sum"])
      expect(names(COMMANDS)).toContain(name);
    for (const name of ["\\mathbb", "\\quad", "\\begin{pmatrix}", "\\ce", "\\pu"])
      expect(names(COMMANDS)).toContain(name);
  });

  test("each has a one-line meaning", () => {
    for (const command of COMMANDS) expect(command.meaning).toMatch(/^[^\n]+$/);
  });

  test("an environment's snippet ends it", () => {
    const pmatrix = COMMANDS.find(({ name }) => name === "\\begin{pmatrix}");

    expect(pmatrix?.snippet).toMatch(/^\\begin\{pmatrix\}.*\\\\ \\end\{pmatrix\}$/);
  });
});

describe("matching a typed command", () => {
  test("lists the commands that start with it, the shortest first", () => {
    expect(names(matching("\\inf")).slice(0, 2)).toEqual(["\\inf", "\\infty"]);
  });

  test("puts the common ones first", () => {
    const found = names(matching("\\fr"));

    expect(found[0]).toBe("\\frac");
    expect(found).toEqual(expect.arrayContaining(["\\frak", "\\frown"]));
  });

  test("puts the exact case first", () => {
    expect(names(matching("\\Del"))[0]).toBe("\\Delta");
    expect(names(matching("\\del"))[0]).toBe("\\delta");
  });

  test("goes by name only, never by meaning", () => {
    expect(matching("\\integral")).toEqual([]);
  });

  test("lists every command for a bare backslash", () => {
    expect(matching("\\")).toHaveLength(COMMANDS.length);
  });

  test("finds an environment by its name", () => {
    expect(names(matching("\\begin{pm"))).toEqual(["\\begin{pmatrix}"]);
  });
});

describe("the cheatsheet's search", () => {
  test("finds by meaning", () => {
    expect(names(search("integral"))).toContain("\\int");
  });

  test("finds by keyword", () => {
    expect(names(search("piecewise"))).toContain("\\begin{cases}");
  });

  test("finds by name", () => {
    expect(names(search("\\frac"))).toContain("\\frac");
  });

  test("needs every word", () => {
    expect(names(search("double integral"))).toContain("\\iint");
    expect(names(search("double integral"))).not.toContain("\\int");
  });

  test("finds nothing for nonsense", () => {
    expect(search("qwerty")).toEqual([]);
  });

  test("lists every command with no query", () => {
    expect(search("  ")).toHaveLength(COMMANDS.length);
  });
});

describe("the Deck's Macros as commands", () => {
  const macros = [
    { name: "\\norm", definition: "\\left\\| #1 \\right\\|" },
    { name: "\\inner", definition: "\\left\\langle #1, #2 \\right\\rangle" },
    { name: "\\eps", definition: "\\varepsilon" },
    { name: "\\frac", definition: "#1/#2" },
  ];

  test("insert a slot per argument, render with sample arguments, and mean their definition", () => {
    const [norm, inner, eps] = macroCommands(macros);

    expect(norm).toMatchObject({ snippet: "\\norm{▯}", preview: "\\norm{x}", group: "Macros" });
    expect(inner).toMatchObject({ snippet: "\\inner{▯}{▯}", preview: "\\inner{x}{y}" });
    expect(eps).toMatchObject({ snippet: "\\eps", meaning: "\\varepsilon" });
    expect(typeset(previewOf(norm ?? COMMANDS[0]!), false, macros)).toHaveProperty("html");
  });

  test("are matched by the same prefix rule as KaTeX's commands", () => {
    expect(names(matching("\\no", macros))[0]).toBe("\\norm");
    expect(names(matching("\\e", macros))).toContain("\\eps");
    expect(names(matching("\\no"))).not.toContain("\\norm");
  });

  test("take the place of KaTeX's command of their name", () => {
    const fracs = matching("\\frac", macros);

    expect(names(fracs).filter((name) => name === "\\frac")).toHaveLength(1);
    expect(fracs[0]?.group).toBe("Macros");
  });

  test("are found by the cheatsheet's search, by name and definition", () => {
    expect(names(search("norm", macros))).toContain("\\norm");
    expect(names(search("langle", macros))).toContain("\\inner");
    expect(search("", macros)).toHaveLength(COMMANDS.length - 1 + macros.length);
  });

  test("keep their identity while the list does", () => {
    expect(macroCommands(macros)[0]).toBe(macroCommands(macros)[0]);
  });
});
