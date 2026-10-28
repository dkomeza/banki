import { describe, expect, test } from "bun:test";
import { cardParser } from "./card-parser";

/** The source of each node named `name` in `doc`'s tree, in document order. */
function nodes(doc: string, name: string): string[] {
  const found: string[] = [];
  cardParser.parse(doc).iterate({
    enter: (node) => {
      if (node.name === name) found.push(doc.slice(node.from, node.to));
    },
  });
  return found;
}

/** The names of the Document's top-level blocks. */
function blocks(doc: string): string[] {
  const names: string[] = [];
  const cursor = cardParser.parse(doc).cursor();
  if (cursor.firstChild()) {
    do names.push(cursor.name);
    while (cursor.nextSibling());
  }
  return names;
}

/** Every Formula node's source, inline and display. */
const formulas = (doc: string) =>
  [
    ...nodes(doc, "InlineFormula"),
    ...nodes(doc, "DisplayFormula"),
    ...nodes(doc, "DisplayFormulaBlock"),
  ].toSorted((a, b) => doc.indexOf(a) - doc.indexOf(b));

describe("inline Formulas, by Pandoc's rules", () => {
  test("$x$ is a Formula", () => {
    expect(nodes("Let $x$ be", "InlineFormula")).toEqual(["$x$"]);
    expect(nodes("Let $x$ be", "FormulaMark")).toEqual(["$", "$"]);
  });

  test('"$5 and $10" stays text', () => {
    expect(formulas("costs $5 and $10")).toEqual([]);
  });

  test("a $ followed by whitespace doesn't open", () => {
    expect(formulas("a $ x$ b")).toEqual([]);
  });

  test("a $ preceded by whitespace doesn't close, and the next one may", () => {
    expect(formulas("$x $")).toEqual([]);
    expect(nodes("$a $b$", "InlineFormula")).toEqual(["$a $b$"]);
  });

  test("a $ followed by a digit doesn't close", () => {
    expect(formulas("$x$5")).toEqual([]);
    expect(nodes("$x$5 and $y$", "InlineFormula")).toEqual(["$x$5 and $y$"]);
  });

  test("two Formulas in a line", () => {
    expect(nodes("$a$ and $b$.", "InlineFormula")).toEqual(["$a$", "$b$"]);
  });

  test("crosses a line break but never a blank line", () => {
    expect(nodes("$a +\nb$", "InlineFormula")).toEqual(["$a +\nb$"]);
    expect(formulas("$a +\n\nb$")).toEqual([]);
  });

  test("an unclosed $ is text", () => {
    expect(formulas("$x")).toEqual([]);
    expect(formulas("$")).toEqual([]);
  });

  test("is atomic: no emphasis inside", () => {
    expect(nodes("$a*b*c$", "Emphasis")).toEqual([]);
    expect(nodes("$a*b*c$", "InlineFormula")).toEqual(["$a*b*c$"]);
  });
});

describe("display Formulas", () => {
  test("$$…$$ inside a paragraph", () => {
    expect(nodes("so $$x^2$$ holds", "DisplayFormula")).toEqual(["$$x^2$$"]);
    expect(nodes("so $$x^2$$ holds", "FormulaMark")).toEqual(["$$", "$$"]);
  });

  test("$$…$$ across a paragraph's lines", () => {
    expect(nodes("so $$a\n= b$$ holds", "DisplayFormula")).toEqual(["$$a\n= b$$"]);
  });

  test("a block on its own lines, across lines a paragraph would end at", () => {
    const doc = "$$\\begin{align}\nf(x) &= x^2\n  - 2x\n\n# not a heading\n\\end{align}$$";
    expect(blocks(doc)).toEqual(["DisplayFormulaBlock"]);
    expect(nodes(doc, "DisplayFormulaBlock")).toEqual([doc]);
  });

  test("a block ends the paragraph above it, and a paragraph follows it", () => {
    const doc = "Start from:\n$$\n\\frac{1}{1+t}\n$$\nthen integrate.";
    expect(blocks(doc)).toEqual(["Paragraph", "DisplayFormulaBlock", "Paragraph"]);
  });

  test("text after the closing $$ keeps it in the paragraph", () => {
    const doc = "$$x$$ is display";
    expect(blocks(doc)).toEqual(["Paragraph"]);
    expect(nodes(doc, "DisplayFormula")).toEqual(["$$x$$"]);
  });

  test("an unclosed or empty $$ is text, and its second $ may still open", () => {
    expect(formulas("$$x")).toEqual([]);
    expect(formulas("a $$$$ b")).toEqual([]);
    expect(blocks("$$\nx")).toEqual(["Paragraph"]);
    expect(nodes("$$x$", "InlineFormula")).toEqual(["$x$"]);
  });

  test("a block inside a blockquote keeps its quote marks", () => {
    const doc = "> $$\n> x\n> $$";
    expect(nodes(doc, "DisplayFormulaBlock")).toEqual(["$$\n> x\n> $$"]);
    expect(nodes(doc, "QuoteMark")).toHaveLength(3);
  });

  test("indented four spaces it is code", () => {
    expect(blocks("    $$x$$")).toEqual(["CodeBlock"]);
  });
});

describe("dollar signs that aren't Formulas", () => {
  test("\\$ is a literal dollar and never opens a Formula", () => {
    expect(formulas("\\$x$")).toEqual([]);
    expect(nodes("\\$x$", "Escape")).toEqual(["\\$"]);
    expect(formulas("\\$\\$x$$")).toEqual([]);
  });

  test("\\$ inside a Formula doesn't close it", () => {
    expect(nodes("$a\\$b$", "InlineFormula")).toEqual(["$a\\$b$"]);
    expect(nodes("so $$a\\$$b$$", "DisplayFormula")).toEqual(["$$a\\$$b$$"]);
  });

  test("$ in inline code is code", () => {
    expect(formulas("`$x$` and `$$y$$`")).toEqual([]);
    expect(nodes("`$x$`", "InlineCode")).toEqual(["`$x$`"]);
  });

  test("a $ in inline code never closes a Formula opened before it", () => {
    expect(formulas("Price $x and `$y` end")).toEqual([]);
    expect(nodes("Price $x and `$y` end", "InlineCode")).toEqual(["`$y`"]);
    expect(nodes("$a `b$` c$", "InlineFormula")).toEqual(["$a `b$` c$"]);
    expect(formulas("so $$a `$$` b")).toEqual([]);
    expect(nodes("so $$a `$$` b", "InlineCode")).toEqual(["`$$`"]);
  });

  test("an unmatched backtick doesn't hide the closing $", () => {
    expect(nodes("$a ` b$", "InlineFormula")).toEqual(["$a ` b$"]);
  });

  test("$ in a code block is code", () => {
    expect(formulas("```\n$x$\n$$\ny\n$$\n```")).toEqual([]);
    expect(formulas("    $x$")).toEqual([]);
  });
});

describe("Markdown", () => {
  test("a single newline keeps the paragraph, a blank line starts a new one", () => {
    expect(blocks("one\ntwo")).toEqual(["Paragraph"]);
    expect(blocks("one\n\ntwo")).toEqual(["Paragraph", "Paragraph"]);
  });

  test("GFM tables", () => {
    const doc = "| a | b |\n| - | - |\n| $x$ | 2 |";
    expect(blocks(doc)).toEqual(["Table"]);
    expect(nodes(doc, "TableCell")).toEqual(["a", "b", "$x$", "2"]);
    expect(nodes(doc, "InlineFormula")).toEqual(["$x$"]);
  });

  test("GFM strikethrough", () => {
    expect(nodes("~~gone~~", "Strikethrough")).toEqual(["~~gone~~"]);
  });

  test("raw HTML is text: no HTML block, and no entities", () => {
    // A line that would open an HTML block still ends a paragraph above it.
    expect(blocks("<div>\n**x**\n</div>")).toEqual(["Paragraph", "Paragraph"]);
    expect(nodes("<div>\n**x**\n</div>", "StrongEmphasis")).toEqual(["**x**"]);
    expect(nodes("<script>alert(1)</script>", "HTMLBlock")).toEqual([]);
    expect(nodes("a &amp; b", "Entity")).toEqual([]);
  });
});
