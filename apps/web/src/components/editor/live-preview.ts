import type { AutoClose, Macro } from "@banki/shared";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentLess,
  indentMore,
} from "@codemirror/commands";
import { deleteMarkupBackward, insertNewlineContinueMarkup } from "@codemirror/lang-markdown";
import { indentUnit } from "@codemirror/language";
import { Compartment, EditorState, type Extension, type StateEffect } from "@codemirror/state";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { autoCloseExtension } from "./auto-close";
import { autoCloseChoice, formattingKeymap, previewCore, submitAction } from "./core";
import { FORMATTING, type Format, INLINE_FORMATS } from "./formatting";
import { formulaMacros } from "./formula-macros";
import { blockAt, livePreviewDecorations } from "./decorations";
import { continueInGrid, enterGrid, focusFirstCell, TableWidget } from "./table-grid";

// The live-preview editor (ADR-0004): CodeMirror 6 on the Markdown source,
// decorated from the Card parser's tree. Nothing in it is about Cards: a side
// of a Card uses it, and so will a typed answer.

/** Four spaces: what Tab indents by, nesting under `- ` and `1. ` alike. */
const INDENT = "    ";

/** A side's preview: blocks and all, its tables as grids. */
const sideDecorations = livePreviewDecorations({
  blocks: true,
  table: (source, state) => TableWidget.of(source, state),
});

/**
 * ArrowDown from the last line before a block the preview draws, or ArrowUp
 * from the first line after it, moves into it rather than over it: into a
 * table's grid, or into the source of a display Formula or a code block,
 * which shows it.
 */
function moveIntoBlock(view: EditorView, forward: boolean): boolean {
  const range = view.state.selection.main;
  if (!range.empty) return false;
  const { doc } = view.state;
  const line = doc.lineAt(range.head);
  // Only from the line's first or last row, where the motion leaves it.
  if (doc.lineAt(view.moveVertically(range, forward).head).number === line.number) return false;
  const neighbour = forward ? line.number + 1 : line.number - 1;
  if (neighbour < 1 || neighbour > doc.lines) return false;
  const at = doc.line(neighbour).from;
  if (enterGrid(view, at, !forward)) return true;
  const block = blockAt(view.state.field(sideDecorations), at);
  if (block === null) return false;
  view.dispatch({ selection: { anchor: forward ? block.from : block.to }, scrollIntoView: true });
  return true;
}

/**
 * Typing that completes a table's delimiter row turns the table into a grid
 * around the cursor: the cursor goes on into the grid, to its last row (a
 * new first row under a lone header), rather than being left where the grid
 * now stands.
 */
const followIntoGrid = EditorView.updateListener.of((update) => {
  if (!update.docChanged || !update.view.hasFocus) return;
  if (!update.transactions.some((tr) => tr.isUserEvent("input") || tr.isUserEvent("delete")))
    return;
  const { head } = update.state.selection.main;
  const block = blockAt(update.state.field(sideDecorations), head);
  if (block === null || head <= block.from || head > block.to) return;
  const { view } = update;
  requestAnimationFrame(() => continueInGrid(view, head));
});

/**
 * What the editor does for an auto-close choice, and the choice, for its
 * tables; and the Macros its Formulas are typeset with.
 */
const settings = (choice: AutoClose, macros: readonly Macro[]) => [
  autoCloseChoice.of(choice),
  autoCloseExtension(choice),
  formulaMacros.of(macros),
];

/**
 * The editor's extension. `autoClose`, `macros` and `readOnly` sit in compartments,
 * so {@link reconfigure} changes them as the Setting and the form do.
 */
export function livePreview({
  placeholder: hint,
  onSubmit,
  autoClose,
  macros,
  readOnly,
}: {
  placeholder: string;
  /** What Ctrl/Cmd+Enter does. */
  onSubmit: () => void;
  autoClose: AutoClose;
  /** The Deck's effective Macros. */
  macros: readonly Macro[];
  readOnly: boolean;
}): {
  extension: Extension;
  reconfigure: (to: {
    autoClose: AutoClose;
    macros: readonly Macro[];
    readOnly: boolean;
  }) => StateEffect<unknown>[];
} {
  const closing = new Compartment();
  const editable = new Compartment();
  return {
    extension: [
      previewCore(sideDecorations),
      followIntoGrid,
      history(),
      EditorView.lineWrapping,
      indentUnit.of(INDENT),
      EditorState.tabSize.of(INDENT.length),
      placeholder(hint),
      EditorView.contentAttributes.of({ "aria-multiline": "true" }),
      submitAction.of(onSubmit),
      closing.of(settings(autoClose, macros)),
      editable.of(EditorState.readOnly.of(readOnly)),
      keymap.of([
        ...formattingKeymap,
        { key: "Mod-Enter", run: (view) => (view.state.facet(submitAction)(), true) },
        // Tab always indents; Escape then Tab leaves the editor (CodeMirror's own).
        { key: "Tab", run: indentMore },
        { key: "Shift-Tab", run: indentLess },
        { key: "Enter", run: insertNewlineContinueMarkup },
        { key: "Backspace", run: deleteMarkupBackward },
        { key: "ArrowDown", run: (view) => moveIntoBlock(view, true) },
        { key: "ArrowUp", run: (view) => moveIntoBlock(view, false) },
        ...historyKeymap,
        ...defaultKeymap,
      ]),
    ],
    reconfigure: (to) => [
      closing.reconfigure(settings(to.autoClose, to.macros)),
      editable.reconfigure(EditorState.readOnly.of(to.readOnly)),
    ],
  };
}

/**
 * Applies `format` where the User is writing: in the table cell being edited
 * when it stays on its line, else in the side's editor `view`.
 */
export function applyFormat(view: EditorView, format: Format, cell: EditorView | null): void {
  const target = cell !== null && INLINE_FORMATS.has(format) ? cell : view;
  if (target.state.readOnly) return;
  if (format === "table") {
    FORMATTING.table(view);
    focusFirstCell(view, view.state.selection.main.head);
    return;
  }
  FORMATTING[format](target);
  target.focus();
}
