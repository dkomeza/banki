import { cardParser } from "@banki/shared";

/** The names of the nodes `doc` parses to, in order. */
function namesOf(doc: string): string[] {
  const names: string[] = [];
  cardParser.parse(doc).iterate({ enter: (node) => void names.push(node.name) });
  return names;
}
import {
  EditorSelection,
  EditorState,
  type StateCommand,
  type Transaction,
} from "@codemirror/state";
import { describe, expect, test } from "vitest";
import { FORMATTING, NEW_TABLE, tableInsertion } from "./formatting";
import { parseTable } from "./table-model";

/**
 * Runs `command` on `doc` with the selection `[from, to]`, written into the
 * doc as `|` (a cursor) or `[` and `]` (a selection), and answers the doc after
 * it the same way.
 */
function run(command: StateCommand, marked: string, readOnly = false): string {
  const from = marked.search(/[|[]/);
  const doc = marked.replace(/[|[\]]/g, "");
  const close = marked.indexOf("]");
  const to = close === -1 ? from : close - 1;
  let state = EditorState.create({
    doc,
    selection: EditorSelection.range(from, to),
    extensions: EditorState.readOnly.of(readOnly),
  });
  command({
    state,
    dispatch: (tr: Transaction) => {
      state = tr.state;
    },
  });
  const { main } = state.selection;
  const text = state.doc.toString();
  if (main.empty) return `${text.slice(0, main.head)}|${text.slice(main.head)}`;
  return `${text.slice(0, main.from)}[${text.slice(main.from, main.to)}]${text.slice(main.to)}`;
}

describe("the shortcuts' wrapping", () => {
  test.each([
    ["bold", "**"],
    ["italic", "*"],
    ["code", "`"],
    ["formula", "$"],
  ] as const)("%s wraps the selection in %s, keeping it selected", (format, marker) => {
    expect(run(FORMATTING[format], "say [hello] there")).toBe(
      `say ${marker}[hello]${marker} there`,
    );
  });

  test.each([
    ["bold", "**"],
    ["italic", "*"],
    ["code", "`"],
    ["formula", "$"],
  ] as const)(
    "%s puts the cursor between new markers when nothing is selected",
    (format, marker) => {
      expect(run(FORMATTING[format], "say | there")).toBe(`say ${marker}|${marker} there`);
    },
  );

  test("changes nothing while the editor is read-only", () => {
    expect(run(FORMATTING.bold, "say [hello]", true)).toBe("say [hello]");
  });
});

describe("the toolbar's blocks", () => {
  test("lists start each selected line with a marker", () => {
    expect(run(FORMATTING.bulletedList, "[one\ntwo]")).toBe("- [one\n- two]");
    expect(run(FORMATTING.numberedList, "[one\ntwo]")).toBe("1. [one\n2. two]");
  });

  test("a code block puts its fences on lines of their own", () => {
    expect(run(FORMATTING.codeBlock, "Run |")).toBe("Run \n```\n|\n```");
    expect(run(FORMATTING.codeBlock, "[ls -l]")).toBe("```\n[ls -l]\n```");
  });

  test("a display Formula puts its $$s on lines of their own, a Formula as the Card parser reads it", () => {
    const after = run(FORMATTING.displayFormula, "So |then");

    expect(after).toBe("So \n$$\n|\n$$\nthen");
    expect(namesOf(after.replace("|", "x"))).toContain("DisplayFormulaBlock");
  });
});

describe("the table button", () => {
  test("inserts a two-column table, a header and one row, read as a table", () => {
    const names = namesOf(NEW_TABLE);

    expect(names.filter((name) => name === "Table")).toHaveLength(1);
    expect(names.filter((name) => name === "TableHeader")).toHaveLength(1);
    expect(names.filter((name) => name === "TableRow")).toHaveLength(1);
    expect(parseTable(NEW_TABLE).aligns).toHaveLength(2);
  });

  test.each([
    ["at the start of an empty side", "", ""],
    ["after a paragraph", "Some text\n", "Some text\n"],
    ["in the middle of a line", "Some text", "Some"],
    ["before a paragraph", "\nmore", ""],
  ])("stands as a table of its own %s", (_, doc, before) => {
    const state = EditorState.create({ doc, selection: { anchor: before.length } });
    const { changes, at } = tableInsertion(state);
    const after = state.update({ changes }).state.doc.toString();
    const tables = namesOf(after).filter((name) => name === "Table");

    expect(tables).toHaveLength(1);
    expect(after.slice(at, at + NEW_TABLE.length)).toBe(NEW_TABLE);
  });

  test("puts the cursor at the table's start", () => {
    expect(run(FORMATTING.table, "Text|")).toBe(`Text\n\n|${NEW_TABLE}`);
  });
});
