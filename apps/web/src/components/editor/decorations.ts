import type { CardNode } from "@banki/shared";
import { type EditorState, type Range, StateField, type Transaction } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, type WidgetType } from "@codemirror/view";
import { focusedField, formulaSource, setFocused, treeOf } from "./language";
import { BulletWidget, FormulaWidget, LiveRenderWidget } from "./widgets";

// The live preview's reveal rule: each Formula and each piece of formatting
// renders while the cursor is outside it, and shows its source while the
// cursor or a selection touches it, in the focused editor. Decorations are
// read from the Card parser's tree (ADR-0020).

/** Makes the grid a complete table shows as, from its source. */
export type TableWidgetFactory = (source: string, state: EditorState) => WidgetType;

export type LivePreviewOptions = {
  /**
   * Whether the editor shows blocks: display Formulas on lines of their own,
   * code blocks and tables. A table's one-line cells don't.
   */
  blocks: boolean;
  /** The grid a table shows as, when `blocks` is on. */
  table?: TableWidgetFactory;
};

const hidden = Decoration.replace({});
const noSpellcheck = { spellcheck: "false" };
const formulaSourceMark = Decoration.mark({
  class: "cm-lp-formula-source",
  attributes: noSpellcheck,
});
const mark = (className: string, attributes?: Record<string, string>) =>
  Decoration.mark({ class: className, attributes });
const lineClass = (className: string, attributes?: Record<string, string>) =>
  Decoration.line({ class: className, attributes });

const strong = mark("cm-lp-strong");
const em = mark("cm-lp-em");
const strike = mark("cm-lp-strike");
const inlineCode = mark("cm-lp-code", noSpellcheck);
const link = mark("cm-lp-link");
const heading = lineClass("cm-lp-heading");
const quote = lineClass("cm-lp-quote");
const codeText = mark("cm-lp-codeblock-text", noSpellcheck);
const formulaSourceLine = lineClass("cm-lp-formula-source-line");

const HEADINGS = /^ATXHeading[1-6]$/;
const FENCE = /^\s*(?:`{3,}|~{3,})/;

/** The decorations of `state`, under the reveal rule. */
export function liveDecorations(state: EditorState, options: LivePreviewOptions): DecorationSet {
  const { doc } = state;
  const focused = state.field(focusedField, false) ?? false;
  /** Whether the cursor or a selection touches `from`…`to`, ends included. */
  const touches = (from: number, to: number) =>
    focused && state.selection.ranges.some((range) => range.from <= to && range.to >= from);
  const out: Range<Decoration>[] = [];
  const hide = (from: number, to: number) => {
    if (to > from) out.push(hidden.range(from, to));
  };
  const hideChildren = (node: CardNode, names: readonly string[]) => {
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (names.includes(child.name)) hide(child.from, child.to);
    }
  };
  /** Each line from the one holding `from` to the one holding `to`. */
  const linesOf = (from: number, to: number) => {
    const lines = [];
    for (let n = doc.lineAt(from).number; n <= doc.lineAt(to).number; n++) lines.push(doc.line(n));
    return lines;
  };
  /** Marks an element's text and, off-cursor, hides its marks. */
  const markup = (node: CardNode, decoration: Decoration, marks: readonly string[]) => {
    out.push(decoration.range(node.from, node.to));
    if (!touches(node.from, node.to)) hideChildren(node, marks);
  };

  treeOf(state).iterate({
    enter({ node }) {
      switch (node.name) {
        case "InlineFormula":
        case "DisplayFormula": {
          const display = node.name === "DisplayFormula";
          const source = formulaSource(node, doc);
          if (!touches(node.from, node.to)) {
            out.push(
              Decoration.replace({ widget: new FormulaWidget(source, display, false) }).range(
                node.from,
                node.to,
              ),
            );
          } else {
            out.push(formulaSourceMark.range(node.from, node.to));
            // An inline Formula's render floats in its popover (popover.ts).
            if (display && options.blocks) liveRenderUnder(node.to, source);
          }
          return false;
        }
        case "DisplayFormulaBlock": {
          // In a one-line cell, as in a table on the timeline: on its line.
          if (!options.blocks) {
            if (touches(node.from, node.to)) out.push(formulaSourceMark.range(node.from, node.to));
            else {
              out.push(
                Decoration.replace({
                  widget: new FormulaWidget(formulaSource(node, doc), true, false),
                }).range(node.from, node.to),
              );
            }
            return false;
          }
          const source = formulaSource(node, doc);
          const lines = linesOf(node.from, node.to);
          const from = lines[0]?.from ?? node.from;
          const to = lines.at(-1)?.to ?? node.to;
          if (!touches(node.from, node.to)) {
            out.push(
              Decoration.replace({
                widget: new FormulaWidget(source, true, true),
                block: true,
              }).range(from, to),
            );
          } else {
            for (const line of lines) out.push(formulaSourceLine.range(line.from));
            out.push(formulaSourceMark.range(node.from, node.to));
            liveRenderUnder(node.to, source);
          }
          return false;
        }
        case "StrongEmphasis":
          markup(node, strong, ["EmphasisMark"]);
          return true;
        case "Emphasis":
          markup(node, em, ["EmphasisMark"]);
          return true;
        case "Strikethrough":
          markup(node, strike, ["StrikethroughMark"]);
          return true;
        case "InlineCode":
          markup(node, inlineCode, ["CodeMark"]);
          return false;
        case "Link": {
          if (touches(node.from, node.to)) {
            out.push(link.range(node.from, node.to));
            return false;
          }
          // Its label shows underlined; its brackets and URL hide.
          const marks = node.getChildren("LinkMark");
          const [open, close] = marks;
          if (open === undefined || close === undefined) return false;
          if (close.from > open.to) out.push(link.range(open.to, close.from));
          hide(node.from, open.to);
          hide(close.from, node.to);
          return true;
        }
        case "FencedCode":
          if (options.blocks) codeBlock(node);
          return false;
        case "Blockquote":
          for (const line of linesOf(node.from, node.to)) out.push(quote.range(line.from));
          return true;
        case "QuoteMark": {
          const line = doc.lineAt(node.from);
          if (touches(line.from, line.to)) return true;
          // The mark and the space after it.
          hide(node.from, doc.sliceString(node.to, node.to + 1) === " " ? node.to + 1 : node.to);
          return true;
        }
        case "ListMark": {
          const text = doc.sliceString(node.from, node.to);
          if ((text === "-" || text === "*") && !touches(node.from, node.to)) {
            out.push(Decoration.replace({ widget: new BulletWidget() }).range(node.from, node.to));
          }
          return true;
        }
        case "Table": {
          if (!options.blocks || options.table === undefined) return false;
          const from = doc.lineAt(node.from).from;
          const to = doc.lineAt(node.to).to;
          out.push(
            Decoration.replace({
              widget: options.table(doc.sliceString(from, to), state),
              block: true,
            }).range(from, to),
          );
          return false;
        }
        default:
          if (HEADINGS.test(node.name)) {
            out.push(heading.range(doc.lineAt(node.from).from));
            const headerMark = node.getChild("HeaderMark");
            if (headerMark !== null && !touches(node.from, node.to)) {
              // The `#`s and the space after them.
              hide(headerMark.from, Math.min(headerMark.to + 1, node.to));
            }
          }
          return true;
      }
    },
  });
  return Decoration.set(out, true);

  /** Puts a display Formula's live render under the line it ends on. */
  function liveRenderUnder(end: number, source: string) {
    out.push(
      Decoration.widget({ widget: new LiveRenderWidget(source), block: true, side: 1 }).range(
        doc.lineAt(end).to,
      ),
    );
  }

  /**
   * A code block in monospace on a muted background, its fences hidden while
   * the cursor is outside it.
   */
  function codeBlock(node: CardNode) {
    const open = touches(node.from, node.to);
    const lines = linesOf(node.from, node.to);
    const last = lines.length - 1;
    const closed = last > 0 && FENCE.test(lines[last]?.text ?? "");
    // The lines shown: all of them while open, else those between the fences.
    const firstShown = open ? 0 : 1;
    const lastShown = open || !closed ? last : last - 1;
    lines.forEach((line, i) => {
      if (i < firstShown || i > lastShown) {
        out.push(Decoration.replace({ block: true }).range(line.from, line.to));
        return;
      }
      const classes = ["cm-lp-codeblock"];
      if (i === firstShown) classes.push("cm-lp-codeblock-first");
      if (i === lastShown) classes.push("cm-lp-codeblock-last");
      out.push(lineClass(classes.join(" "), noSpellcheck).range(line.from));
    });
    out.push(codeText.range(node.from, node.to));
  }
}

/** Whether `tr` can change what the live preview shows. */
export const changesPreview = (tr: Transaction) =>
  tr.docChanged ||
  tr.selection !== undefined ||
  tr.reconfigured ||
  tr.startState.readOnly !== tr.state.readOnly ||
  tr.effects.some((effect) => effect.is(setFocused));

/** The live preview's decorations, kept up to date as the editor changes. */
export function livePreviewDecorations(options: LivePreviewOptions) {
  return StateField.define<DecorationSet>({
    create: (state) => liveDecorations(state, options),
    update: (value, tr) => (changesPreview(tr) ? liveDecorations(tr.state, options) : value),
    provide: (field) => EditorView.decorations.from(field),
  });
}

/**
 * The block the preview draws over the line at `pos` (a display Formula, a
 * table, a code block's hidden fence), as the range of source it stands for.
 */
export function blockAt(
  decorations: DecorationSet,
  pos: number,
): { from: number; to: number } | null {
  let found: { from: number; to: number } | null = null;
  decorations.between(pos, pos, (from, to, decoration) => {
    if (decoration.spec.block === true && to > from && from <= pos && pos <= to) {
      found = { from, to };
      return false;
    }
    return undefined;
  });
  return found;
}
