import { CARD_EXTENSIONS, type CardNode } from "@banki/shared";
import { commonmarkLanguage, markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { type EditorState, StateEffect, StateField, type Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

// What the live-preview editor reads and knows about its text: CodeMirror's
// Markdown mode configured as the Card parser is (ADR-0020), so the editor
// decorates the very tree the display renders, and whether the editor has
// the focus, since source shows only where the User is writing.

/** CodeMirror's Markdown mode, reading as `@banki/shared`'s Card parser reads. */
export const cardLanguage = markdown({
  base: commonmarkLanguage,
  extensions: CARD_EXTENSIONS,
  // Its own keys are bound in live-preview.ts, with the rest.
  addKeymap: false,
  completeHTMLTags: false,
  pasteURLAsLink: false,
});

/** How long a parse may take before the editor goes on with what it has, in ms. */
const PARSE_BUDGET = 200;

/** The document's tree, parsed to its end: a Card is short. */
export function treeOf(state: EditorState) {
  return ensureSyntaxTree(state, state.doc.length, PARSE_BUDGET) ?? syntaxTree(state);
}

export const FORMULAS: ReadonlySet<string> = new Set([
  "InlineFormula",
  "DisplayFormula",
  "DisplayFormulaBlock",
]);

/** The innermost Formula around `pos`, looking at the side `side` of it. */
export function formulaAt(state: EditorState, pos: number, side: -1 | 1): CardNode | null {
  for (
    let node: CardNode | null = treeOf(state).resolveInner(pos, side);
    node;
    node = node.parent
  ) {
    if (FORMULAS.has(node.name)) return node;
  }
  return null;
}

/**
 * A Formula's LaTeX: the text between its delimiters, without the `>` of a
 * blockquote it is in on its later lines.
 */
export function formulaSource(node: CardNode, doc: Text): string {
  const marks = node.getChildren("FormulaMark");
  const from = marks[0]?.to ?? node.from;
  const to = marks[1]?.from ?? node.to;
  return doc
    .sliceString(from, to)
    .split("\n")
    .map((line, i) => (i === 0 ? line : line.replace(/^\s*>\s?/, "")))
    .join("\n");
}

/** Where a Formula's source ends: before its closing delimiter. */
export function formulaSourceEnd(node: CardNode): number {
  const marks = node.getChildren("FormulaMark");
  return marks.length >= 2 ? (marks[1]?.from ?? node.to) : node.to;
}

/** Tells the editor it gained or lost the focus. */
export const setFocused = StateEffect.define<boolean>();

/** Whether the editor has the focus: only then does source show where the cursor is. */
export const focusedField = StateField.define<boolean>({
  create: () => false,
  update(focused, tr) {
    for (const effect of tr.effects) if (effect.is(setFocused)) focused = effect.value;
    return focused;
  },
});

/** Keeps {@link focusedField} in step with the editor's focus. */
export const trackFocus = [
  focusedField,
  EditorView.focusChangeEffect.of((_state, focused) => setFocused.of(focused)),
];
