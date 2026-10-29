import { describe, expect, test } from "vitest";
import { typeset } from "@/lib/formula";
import { COMMANDS, GROUPS, matching, previewOf, search } from "./latex-commands";

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
