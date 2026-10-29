import { EditorSelection, type EditorState, type StateCommand } from "@codemirror/state";

// The formatting the shortcuts and the toolbar apply, as commands on the
// editor's state. Each is one change, so one undo takes it back.

/**
 * Wraps each selection in `before` and `after`, keeping it selected inside
 * them, or, where nothing is selected, puts the cursor between new ones.
 */
export const wrapWith =
  (before: string, after = before): StateCommand =>
  ({ state, dispatch }) => {
    if (state.readOnly) return false;
    dispatch(
      state.update(
        state.changeByRange((range) =>
          range.empty
            ? {
                changes: { from: range.from, insert: before + after },
                range: EditorSelection.cursor(range.from + before.length),
              }
            : {
                changes: [
                  { from: range.from, insert: before },
                  { from: range.to, insert: after },
                ],
                range: EditorSelection.range(
                  range.anchor + before.length,
                  range.head + before.length,
                ),
              },
        ),
        { userEvent: "input.format", scrollIntoView: true },
      ),
    );
    return true;
  };

/** The numbers of the lines the selections are on, each once, in order. */
function selectedLines(state: EditorState): number[] {
  const lines = new Set<number>();
  for (const range of state.selection.ranges) {
    const last = state.doc.lineAt(range.to).number;
    for (let n = state.doc.lineAt(range.from).number; n <= last; n++) lines.add(n);
  }
  return [...lines].toSorted((a, b) => a - b);
}

/** Starts each selected line with a list marker: `- `, or `1. `, `2. `, … */
export const makeList =
  (ordered: boolean): StateCommand =>
  ({ state, dispatch }) => {
    if (state.readOnly) return false;
    const changes = selectedLines(state).map((n, i) => ({
      from: state.doc.line(n).from,
      insert: ordered ? `${i + 1}. ` : "- ",
    }));
    dispatch(state.update({ changes, userEvent: "input.format", scrollIntoView: true }));
    return true;
  };

/**
 * Puts the selection, or an empty line for the cursor, between an `open` and
 * a `close` line of their own: a code block's fences, a display Formula's
 * `$$`s. Text before the cursor on its line stays above them, and text after
 * the selection goes below.
 */
export const fenced =
  (open: string, close: string): StateCommand =>
  ({ state, dispatch }) => {
    if (state.readOnly) return false;
    const { from, to } = state.selection.main;
    const before = from === state.doc.lineAt(from).from ? "" : "\n";
    const after = to === state.doc.lineAt(to).to ? "" : "\n";
    const inside = state.sliceDoc(from, to);
    const start = from + before.length + open.length + 1;
    dispatch(
      state.update({
        changes: { from, to, insert: `${before}${open}\n${inside}\n${close}${after}` },
        selection: EditorSelection.range(start, start + inside.length),
        userEvent: "input.format",
        scrollIntoView: true,
      }),
    );
    return true;
  };

/** What the table button inserts: a header and one row, two columns wide. */
export const NEW_TABLE = "|     |     |\n| --- | --- |\n|     |     |";

/**
 * Where a new table goes, and the change that puts it there: in place of the
 * selection, with a blank line between it and any text before or after it,
 * so it stands as a table of its own.
 */
export function tableInsertion(state: EditorState): {
  changes: { from: number; to: number; insert: string };
  /** Where the table starts, once inserted. */
  at: number;
} {
  const { from, to } = state.selection.main;
  const { doc } = state;
  const startLine = doc.lineAt(from);
  const endLine = doc.lineAt(to);
  const textBefore =
    from > startLine.from ||
    (startLine.number > 1 && doc.line(startLine.number - 1).text.trim() !== "");
  const textAfter =
    to < endLine.to ||
    (endLine.number < doc.lines && doc.line(endLine.number + 1).text.trim() !== "");
  const lead = from > startLine.from ? "\n\n" : textBefore ? "\n" : "";
  const trail = to < endLine.to ? "\n\n" : textAfter ? "\n" : "";
  return {
    changes: { from, to, insert: `${lead}${NEW_TABLE}${trail}` },
    at: from + lead.length,
  };
}

/** Inserts a new two-column table ({@link tableInsertion}), with the cursor at its start. */
export const insertTable: StateCommand = ({ state, dispatch }) => {
  if (state.readOnly) return false;
  const { changes, at } = tableInsertion(state);
  dispatch(
    state.update({
      changes,
      selection: EditorSelection.cursor(at),
      userEvent: "input.format",
      scrollIntoView: true,
    }),
  );
  return true;
};

/** The formatting a shortcut or a toolbar button applies. */
export const FORMATTING = {
  bold: wrapWith("**"),
  italic: wrapWith("*"),
  code: wrapWith("`"),
  formula: wrapWith("$"),
  bulletedList: makeList(false),
  numberedList: makeList(true),
  codeBlock: fenced("```", "```"),
  displayFormula: fenced("$$", "$$"),
  table: insertTable,
} satisfies Record<string, StateCommand>;

export type Format = keyof typeof FORMATTING;

/** The formatting that stays on its line, which a table's one-line cell takes too. */
export const INLINE_FORMATS: ReadonlySet<Format> = new Set(["bold", "italic", "code", "formula"]);
