import type { Input } from "@lezer/common";
import {
  type BlockContext,
  type InlineContext,
  type Line,
  type MarkdownConfig,
  parser,
  Strikethrough,
  Table,
} from "@lezer/markdown";

// The one parser that reads a Card (ADR-0020): CommonMark with GFM tables and
// strikethrough, and Formulas. The read-only display renders its tree, and the
// live-preview editor decorates the same tree, so both agree on what is a
// Formula, an escaped `\$` or a line break.
//
// A Formula's nodes:
// - `InlineFormula`: `$…$` inside a paragraph, by Pandoc's rules: the opening
//   `$` has no whitespace right after it, the closing one none right before it
//   and no digit after it, so "costs $5 and $10" holds no Formula. A
//   paragraph never crosses a blank line, so neither does it.
// - `DisplayFormula`: `$$…$$` inside a paragraph, across its lines.
// - `DisplayFormulaBlock`: a block that starts with `$$` and runs to the
//   closing `$$`, across any lines, blank ones too, with nothing after it on
//   its last line. It ends a paragraph above it.
// Each holds a `FormulaMark` for each delimiter, and its source between them.
//
// `\$` is Markdown's escape, so it is a dollar sign and never opens a
// Formula, and a `$` inside code is code. Raw HTML stays text: there is no
// HTML block, and an inline tag (`HTMLTag`) is for the display to show as
// typed. Entities (`&amp;`) aren't read either, so they show as typed too.

const DOLLAR = 36;
const BACKSLASH = 92;
const WHITESPACE = /\s/;
const DIGIT = /[0-9]/;

/** Where the `$$` closing a display Formula whose source starts at `from` in `text` is, or -1. */
function displayClose(text: string, from: number): number {
  for (let i = from; i < text.length - 1; i++) {
    const char = text.charCodeAt(i);
    if (char === BACKSLASH) i++;
    else if (char === DOLLAR && text.charCodeAt(i + 1) === DOLLAR) return i;
  }
  return -1;
}

/**
 * The document the block context reads. @lezer/markdown keeps it internal;
 * the version is pinned, and the Formula tests fail if it ever moves.
 */
const inputOf = (cx: BlockContext): Input => Reflect.get(cx, "input");

/**
 * Where the `$$` closing a display Formula block that starts on `line` is, or
 * -1 when no block starts there: the line starts with `$$` (not indented as
 * code), a non-empty source follows, and the closing `$$` has nothing but
 * whitespace after it on its line.
 */
function blockClose(cx: BlockContext, line: Line): number {
  if (line.next !== DOLLAR || line.text.charCodeAt(line.pos + 1) !== DOLLAR) return -1;
  if (line.indent - line.baseIndent >= 4) return -1;
  const from = cx.lineStart + line.pos + 2;
  const input = inputOf(cx);
  const rest = input.read(from, input.length);
  const close = displayClose(rest, 0);
  if (close <= 0) return -1;
  const lineEnd = rest.indexOf("\n", close);
  if (rest.slice(close + 2, lineEnd === -1 ? rest.length : lineEnd).trim() !== "") return -1;
  return from + close;
}

/** Where the `$` closing the inline Formula opening at `start` is, or -1 (Pandoc's rules). */
function inlineClose(cx: InlineContext, start: number): number {
  const first = cx.char(start + 1);
  if (first === -1 || first === DOLLAR || WHITESPACE.test(String.fromCharCode(first))) return -1;
  for (let i = start + 1; i < cx.end; i++) {
    const char = cx.char(i);
    if (char === BACKSLASH) {
      i++;
      continue;
    }
    if (char !== DOLLAR) continue;
    const before = String.fromCharCode(cx.char(i - 1));
    const after = cx.char(i + 1);
    if (!WHITESPACE.test(before) && (after === -1 || !DIGIT.test(String.fromCharCode(after)))) {
      return i;
    }
  }
  return -1;
}

/** The Formula extension: `$…$` and `$$…$$`, inline and as a block. */
export const Formula: MarkdownConfig = {
  defineNodes: [
    { name: "InlineFormula" },
    { name: "DisplayFormula" },
    { name: "DisplayFormulaBlock", block: true },
    { name: "FormulaMark" },
  ],
  parseBlock: [
    {
      name: "DisplayFormulaBlock",
      parse(cx, line) {
        const close = blockClose(cx, line);
        if (close === -1) return false;
        const from = cx.lineStart + line.pos;
        const children = [cx.elt("FormulaMark", from, from + 2)];
        // Every line up to the closing one is the Formula's, with any
        // blockquote markers on them.
        while (cx.lineStart + line.text.length < close + 2 && cx.nextLine()) {
          children.push(...line.markers);
        }
        children.push(cx.elt("FormulaMark", close, close + 2));
        cx.addElement(cx.elt("DisplayFormulaBlock", from, close + 2, children));
        cx.nextLine();
        return true;
      },
      endLeaf: (cx, line) => blockClose(cx, line) !== -1,
    },
  ],
  parseInline: [
    {
      name: "Formula",
      parse(cx, next, pos) {
        if (next !== DOLLAR) return -1;
        if (cx.char(pos + 1) === DOLLAR) {
          // On no closing `$$`, the second `$` may still open an inline Formula.
          const close = displayClose(cx.slice(pos, cx.end), 2);
          if (close <= 2) return -1;
          const end = pos + close;
          return cx.addElement(
            cx.elt("DisplayFormula", pos, end + 2, [
              cx.elt("FormulaMark", pos, pos + 2),
              cx.elt("FormulaMark", end, end + 2),
            ]),
          );
        }
        const close = inlineClose(cx, pos);
        if (close === -1) return -1;
        return cx.addElement(
          cx.elt("InlineFormula", pos, close + 1, [
            cx.elt("FormulaMark", pos, pos + 1),
            cx.elt("FormulaMark", close, close + 1),
          ]),
        );
      },
    },
  ],
};

/** The Card parser: CommonMark, GFM tables and strikethrough, and Formulas, with no raw HTML. */
export const cardParser = parser.configure([
  Table,
  Strikethrough,
  Formula,
  { remove: ["HTMLBlock", "Entity"] },
]);

/** A node of a Card's tree. */
export type { SyntaxNode as CardNode } from "@lezer/common";
