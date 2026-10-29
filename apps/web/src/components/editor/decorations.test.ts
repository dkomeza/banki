import { cardParser } from "@banki/shared";
import { EditorSelection, EditorState } from "@codemirror/state";
import { type DecorationSet, WidgetType } from "@codemirror/view";
import { describe, expect, test } from "vitest";
import { blockAt, liveDecorations } from "./decorations";
import { focusedField, setFocused, treeOf, cardLanguage } from "./language";
import { editedInlineFormula } from "./popover";
import { FormulaWidget, LiveRenderWidget } from "./widgets";

class FakeTable extends WidgetType {
  constructor(readonly source: string) {
    super();
  }
  toDOM(): HTMLElement {
    throw new Error("not drawn in tests");
  }
}

/** A side holding `doc`, focused with the cursor at `cursor` (or not focused). */
function side(doc: string, cursor?: number | { from: number; to: number }) {
  const state = EditorState.create({ doc, extensions: [cardLanguage, focusedField] });
  if (cursor === undefined) return state;
  const selection =
    typeof cursor === "number"
      ? EditorSelection.cursor(cursor)
      : EditorSelection.range(cursor.from, cursor.to);
  return state.update({ selection, effects: setFocused.of(true) }).state;
}

/** Every node of `tree`, as its name and range. */
function nodesOf(tree: ReturnType<typeof cardParser.parse>): string[] {
  const nodes: string[] = [];
  tree.iterate({ enter: (node) => void nodes.push(`${node.name}@${node.from}-${node.to}`) });
  return nodes;
}

type Shown = { from: number; to: number; kind: string; text: string };

/** What the decorations do, in order: each range hidden, replaced, marked or classed. */
function shown(state: EditorState, blocks = true): Shown[] {
  const set: DecorationSet = liveDecorations(state, {
    blocks,
    table: (source) => new FakeTable(source),
  });
  const out: Shown[] = [];
  set.between(0, state.doc.length, (from, to, decoration) => {
    const widget: unknown = decoration.spec.widget;
    const className: unknown = decoration.spec.class;
    let kind: string;
    if (widget instanceof FormulaWidget) kind = `formula:${widget.source}`;
    else if (widget instanceof LiveRenderWidget) kind = `live:${widget.source}`;
    else if (widget instanceof FakeTable) kind = "table";
    else if (widget !== undefined) kind = "widget";
    else if (typeof className === "string") kind = className;
    else kind = "hidden";
    out.push({ from, to, kind, text: state.sliceDoc(from, to) });
  });
  return out;
}

/** The kinds of decoration, in no particular order. */
const kinds = (state: EditorState, blocks = true) =>
  shown(state, blocks)
    .map((d) => d.kind)
    .toSorted();
const hiddenText = (state: EditorState) =>
  shown(state)
    .filter((d) => d.kind === "hidden")
    .map((d) => d.text);

describe("the editor's tree", () => {
  test.each([
    "Costs $5 and $10, and $x^2$ is a Formula.",
    String.raw`An escaped \$x$ is a dollar sign.`,
    "$$\n\\sum_n x^n\n$$\nafter",
    "| a | b |\n| - | - |\n| $x$ | **y** |",
    "line one\nline two with `code $x$`",
    "<b>raw</b> HTML &amp; entities stay text",
  ])("is the Card parser's tree for %j", (doc) => {
    expect(nodesOf(treeOf(EditorState.create({ doc, extensions: cardLanguage })))).toEqual(
      nodesOf(cardParser.parse(doc)),
    );
  });
});

describe("the reveal rule for a Formula", () => {
  const doc = "Area $\\pi r^2$ here";

  test("renders it while the cursor is outside it", () => {
    expect(kinds(side(doc, 0))).toEqual(["formula:\\pi r^2"]);
  });

  test("renders it while the editor isn't focused, wherever its cursor is", () => {
    expect(kinds(side(doc))).toEqual(["formula:\\pi r^2"]);
  });

  test.each([
    ["the cursor is in it", 8],
    ["the cursor is just after it", 14],
    ["the cursor is just before it", 5],
    ["a selection crosses it", { from: 0, to: 7 }],
  ])("shows its source while %s, its spellcheck off", (_, cursor) => {
    const decorations = shown(side(doc, cursor));

    expect(decorations).toEqual([
      { from: 5, to: 14, kind: "cm-lp-formula-source", text: "$\\pi r^2$" },
    ]);
  });

  test("reads `\\$` as a dollar sign, as the timeline does", () => {
    expect(kinds(side(String.raw`Pay \$5 and $x$`, 0))).toEqual(["formula:x"]);
  });

  test("puts a display Formula's live render under its source while it is edited", () => {
    const block = "Before\n$$\n\\int_0^1 x\\,dx\n$$\nAfter";

    expect(kinds(side(block, 12))).toEqual([
      "cm-lp-formula-source",
      "cm-lp-formula-source-line",
      "cm-lp-formula-source-line",
      "cm-lp-formula-source-line",
      "live:\n\\int_0^1 x\\,dx\n",
    ]);
    expect(kinds(side(block, 0))).toEqual(["formula:\n\\int_0^1 x\\,dx\n"]);
  });

  test("puts a live render under a display Formula inside a paragraph too", () => {
    expect(kinds(side("So $$e^x$$ grows.", 6))).toEqual(["cm-lp-formula-source", "live:e^x"]);
  });

  test("floats an inline Formula's render in its popover only while it is edited", () => {
    expect(editedInlineFormula(side(doc, 8))?.name).toBe("InlineFormula");
    expect(editedInlineFormula(side(doc, 0))).toBeNull();
    expect(editedInlineFormula(side(doc))).toBeNull();
  });
});

describe("the reveal rule for formatting", () => {
  test("hides each element's marks while the cursor is outside it, one element at a time", () => {
    const doc = "**bold** and *it* and ~~gone~~ end";

    expect(hiddenText(side(doc, doc.length))).toEqual(["**", "**", "*", "*", "~~", "~~"]);
    expect(hiddenText(side(doc, 3))).toEqual(["*", "*", "~~", "~~"]);
  });

  test("hides inline code's backticks off-cursor, its spellcheck off", () => {
    expect(kinds(side("Run `ls` now", 0))).toEqual(["cm-lp-code", "hidden", "hidden"]);
    expect(kinds(side("Run `ls` now", 5))).toEqual(["cm-lp-code"]);
  });

  test("shows a link as its underlined label off-cursor", () => {
    const decorations = shown(side("See [the docs](https://example.com) now", 0));

    expect(decorations.map((d) => [d.kind, d.text])).toEqual([
      ["hidden", "["],
      ["cm-lp-link", "the docs"],
      ["hidden", "](https://example.com)"],
    ]);
  });

  test("hides a heading's #s off-cursor, keeping the line a heading", () => {
    expect(shown(side("## Title\nbody", 12)).map((d) => [d.kind, d.text])).toEqual([
      ["cm-lp-heading", ""],
      ["hidden", "## "],
    ]);
    expect(kinds(side("## Title\nbody", 3))).toEqual(["cm-lp-heading"]);
  });

  test("shows - and * bullets as •, and leaves numbers as typed", () => {
    const doc = "- one\n* two\n1. three";

    expect(kinds(side(doc, doc.length))).toEqual(["widget", "widget"]);
    // The cursor on a marker shows it as typed.
    expect(kinds(side(doc, 0))).toEqual(["widget"]);
  });

  test("hides a code block's fences while the cursor is outside it", () => {
    const doc = "```\nls -l\n```\nafter";
    const off = shown(side(doc, doc.length));

    expect(off.filter((d) => d.kind === "hidden").map((d) => d.text)).toEqual(["```", "```"]);
    expect(off.filter((d) => d.kind.startsWith("cm-lp-codeblock ")).length).toBe(1);
    expect(shown(side(doc, 1)).filter((d) => d.kind === "hidden")).toEqual([]);
  });
});

describe("tables", () => {
  test("show as a grid as soon as the header and delimiter rows are complete", () => {
    expect(kinds(side("| a | b |\n| -", 0))).not.toContain("table");
    expect(kinds(side("| a | b |\n| - | - |", 0))).toEqual(["table"]);
  });

  test("show as a grid with the cursor in them too", () => {
    expect(kinds(side("| a | b |\n| - | - |\n| 1 | 2 |", 3))).toEqual(["table"]);
  });

  test("are a block a key can move into", () => {
    const state = side("above\n| a | b |\n| - | - |\n\nbelow", 0);
    const set = liveDecorations(state, { blocks: true, table: (s) => new FakeTable(s) });

    expect(blockAt(set, 6)).toEqual({ from: 6, to: 25 });
    expect(blockAt(set, 0)).toBeNull();
  });
});

describe("a table's cells", () => {
  test("show no blocks, but Formulas and marks as anywhere", () => {
    expect(kinds(side("**x** $y$", 9), false)).toEqual([
      "cm-lp-formula-source",
      "cm-lp-strong",
      "hidden",
      "hidden",
    ]);
    expect(kinds(side("$$e^x$$"), false)).toEqual(["formula:e^x"]);
  });
});
