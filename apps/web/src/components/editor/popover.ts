import { completionStatus } from "@codemirror/autocomplete";
import { type EditorState, StateField } from "@codemirror/state";
import { EditorView, showTooltip, type Tooltip } from "@codemirror/view";
import { changesPreview } from "./decorations";
import { focusedField, formulaAt, formulaSource, formulaSourceEnd } from "./language";
import { popoverContent } from "./widgets";

// While an inline Formula is edited, its render floats in a small popover
// anchored under it, over the text, which never moves; it goes when the
// cursor leaves. A click on a rendered Formula puts the cursor at the end of
// its source.

/** The inline Formula the cursor is in, in the focused editor, if any. */
export function editedInlineFormula(state: EditorState) {
  if (!(state.field(focusedField, false) ?? false)) return null;
  const { head } = state.selection.main;
  const node = formulaAt(state, head, -1) ?? formulaAt(state, head, 1);
  return node?.name === "InlineFormula" ? node : null;
}

function popoverFor(state: EditorState): Tooltip | null {
  const node = editedInlineFormula(state);
  // The popup's Result pane stands in for it while open.
  if (node === null || completionStatus(state) !== null) return null;
  // Prototype: an empty slot shows as a box in the render.
  const source = formulaSource(node, state.doc).replaceAll("{}", "{\\square}");
  return {
    pos: node.from,
    above: false,
    arrow: false,
    create: () => ({ dom: popoverContent(source) }),
  };
}

/** The popover of the inline Formula being edited. */
export const inlinePopover = StateField.define<Tooltip | null>({
  create: popoverFor,
  update: (value, tr) =>
    changesPreview(tr) || completionStatus(tr.startState) !== completionStatus(tr.state)
      ? popoverFor(tr.state)
      : value,
  provide: (field) => showTooltip.from(field),
});

/** A click on a rendered Formula puts the cursor at the end of its source. */
export const clickToEditFormula = EditorView.domEventHandlers({
  mousedown(event, view) {
    const target = event.target instanceof Element ? event.target.closest(".cm-lp-formula") : null;
    if (!(target instanceof HTMLElement) || view.state.readOnly) return false;
    const node = formulaAt(view.state, view.posAtDOM(target), 1);
    if (node === null) return false;
    event.preventDefault();
    view.focus();
    view.dispatch({ selection: { anchor: formulaSourceEnd(node) }, scrollIntoView: true });
    return true;
  },
});
