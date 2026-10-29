import type { AutoClose } from "@banki/shared";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import {
  EditorSelection,
  EditorState,
  type Extension,
  MapMode,
  Prec,
  RangeSet,
  RangeValue,
  StateEffect,
  StateField,
  type Transaction,
} from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";

// The auto-close Setting in the editor. With brackets on, typing `{`, `(` or
// `[` adds its closing bracket after the cursor (CodeMirror's closeBrackets,
// told these are the brackets). With `$` on too, typing `$` inserts `$$` with
// the cursor between, and typing `$` just before a `$` it added steps over it.

/** The brackets auto-close closes. */
export const BRACKETS = ["(", "[", "{"] as const;

const DOLLAR = "$";

/** Marks the `$` at a position as one auto-close added. */
const addedDollar = StateEffect.define<number>({
  map: (pos, mapping) => mapping.mapPos(pos, 1, MapMode.TrackDel) ?? undefined,
});

const added = new (class extends RangeValue {})();

/** The `$`s auto-close added, on the cursor's line: only those are stepped over. */
const addedDollars = StateField.define<RangeSet<RangeValue>>({
  create: () => RangeSet.empty,
  update(value, tr) {
    let next = value.map(tr.changes);
    if (tr.selection) {
      const line = tr.state.doc.lineAt(tr.selection.main.head);
      next = next.update({ filter: (from) => from >= line.from && from <= line.to });
    }
    for (const effect of tr.effects) {
      if (effect.is(addedDollar))
        next = next.update({ add: [added.range(effect.value, effect.value + 1)] });
    }
    return next;
  },
});

function isAddedDollar(state: EditorState, pos: number): boolean {
  let found = false;
  state.field(addedDollars, false)?.between(pos, pos + 1, (from) => {
    if (from === pos) found = true;
  });
  return found;
}

/**
 * What typing `$` does with `$` on: steps over a `$` auto-close added just
 * after the cursor, wraps a selection in `$`s, or inserts `$$` with the
 * cursor between. After a backslash it is `\$`, a dollar sign, and is typed
 * as it is. Null when the `$` is typed as it is.
 */
export function insertDollar(state: EditorState): Transaction | null {
  if (state.readOnly) return null;
  const { main } = state.selection;
  if (main.empty && state.sliceDoc(main.from - 1, main.from) === "\\") return null;
  if (
    main.empty &&
    state.sliceDoc(main.from, main.from + 1) === DOLLAR &&
    isAddedDollar(state, main.from)
  ) {
    return state.update({
      selection: EditorSelection.cursor(main.from + 1),
      userEvent: "input.type",
      scrollIntoView: true,
    });
  }
  return state.update(
    state.changeByRange((range) =>
      range.empty
        ? {
            changes: { from: range.from, insert: DOLLAR + DOLLAR },
            effects: addedDollar.of(range.from + 1),
            range: EditorSelection.cursor(range.from + 1),
          }
        : {
            changes: [
              { from: range.from, insert: DOLLAR },
              { from: range.to, insert: DOLLAR },
            ],
            effects: addedDollar.of(range.to + 1),
            range: EditorSelection.range(range.anchor + 1, range.head + 1),
          },
    ),
    { userEvent: "input.type", scrollIntoView: true },
  );
}

/** Backspace between a `$` and the `$` auto-close added after it deletes both. */
function deleteDollarPair(view: EditorView): boolean {
  const { state } = view;
  const { main } = state.selection;
  if (state.readOnly || !main.empty || state.selection.ranges.length > 1) return false;
  const pos = main.from;
  if (state.sliceDoc(pos - 1, pos + 1) !== DOLLAR + DOLLAR || !isAddedDollar(state, pos))
    return false;
  view.dispatch({
    changes: { from: pos - 1, to: pos + 1 },
    selection: EditorSelection.cursor(pos - 1),
    userEvent: "delete.backward",
  });
  return true;
}

const dollars: Extension = [
  addedDollars,
  EditorView.inputHandler.of((view, from, to, text) => {
    const { main } = view.state.selection;
    if (text !== DOLLAR || view.composing || from !== main.from || to !== main.to) return false;
    const tr = insertDollar(view.state);
    if (tr === null) return false;
    view.dispatch(tr);
    return true;
  }),
  keymap.of([{ key: "Backspace", run: deleteDollarPair }]),
];

const brackets: Extension = [
  // Above the Markdown mode's own, which would close quotes too.
  Prec.highest(EditorState.languageData.of(() => [{ closeBrackets: { brackets: [...BRACKETS] } }])),
  closeBrackets(),
  keymap.of(closeBracketsKeymap),
];

/** The editor's behaviour for an auto-close choice. */
export function autoCloseExtension(choice: AutoClose): Extension {
  if (choice === "off") return [];
  if (choice === "brackets") return brackets;
  return [brackets, dollars];
}
