import type { AutoClose } from "@banki/shared";
import {
  clearSnippet,
  CompletionContext,
  type CompletionResult,
  insertBracket,
  nextSnippetField,
} from "@codemirror/autocomplete";
import { EditorSelection, EditorState, type Transaction } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { describe, expect, test } from "vitest";
import { autoCloseExtension } from "./auto-close";
import { cardLanguage } from "./language";
import { COMMANDS } from "./latex-commands";
import { insertAtCursor, insideFormula, latexSource, withSlotBoxes } from "./latex-complete";

/** A side holding `marked`, with `|` for the cursor. */
function side(
  marked: string,
  { choice = "off", readOnly = false }: { choice?: AutoClose; readOnly?: boolean } = {},
) {
  return EditorState.create({
    doc: marked.replace("|", ""),
    selection: EditorSelection.cursor(marked.indexOf("|")),
    extensions: [cardLanguage, autoCloseExtension(choice), EditorState.readOnly.of(readOnly)],
  });
}

const shown = (state: EditorState) => {
  const { from, to } = state.selection.main;
  const text = state.doc.toString();
  return from === to
    ? `${text.slice(0, from)}|${text.slice(from)}`
    : `${text.slice(0, from)}[${text.slice(from, to)}]${text.slice(to)}`;
};

/** Just enough of an editor for the snippets: its state, and dispatch. */
class Editor {
  constructor(public state: EditorState) {}
  dispatch = (tr: Transaction) => {
    this.state = tr.state;
  };
  focus() {}
  /** As an EditorView, for the snippets, which use no more of one than this. */
  get view() {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return this as unknown as EditorView;
  }
}

/** The popup's options for `marked`, or null when no popup opens. */
function popup(marked: string, options?: { readOnly?: boolean }): CompletionResult | null {
  const state = side(marked, options);
  const result = latexSource(new CompletionContext(state, state.selection.main.head, false));
  return result instanceof Promise ? null : result;
}

const labels = (result: CompletionResult | null) => result?.options.map(({ label }) => label);

/** Accepts the option named `name` in the popup open in `editor`. */
function accept(editor: Editor, name: string) {
  const result = latexSource(
    new CompletionContext(editor.state, editor.state.selection.main.head, false),
  );
  if (result === null || result instanceof Promise) throw new Error("No popup");
  const option = result.options.find(({ label }) => label === name);
  if (typeof option?.apply !== "function") throw new Error("Not a snippet");
  option.apply(editor.view, option, result.from, result.to ?? editor.state.selection.main.head);
}

/** Types `text` a character at a time; with brackets on, closing them as auto-close does. */
function type(editor: Editor, text: string, brackets: boolean) {
  for (const char of text) {
    const { from, to } = editor.state.selection.main;
    const tr =
      (brackets ? insertBracket(editor.state, char) : null) ??
      editor.state.update({
        changes: { from, to, insert: char },
        selection: EditorSelection.cursor(from + char.length),
      });
    editor.dispatch(tr);
  }
}

const tab = (editor: Editor) => nextSnippetField(editor);

describe("the popup opens", () => {
  test.each([
    ["an inline Formula", "Find $\\fr|$ here."],
    ["a display Formula", "$$\n\\fr|\n$$"],
    ["a display Formula on one line", "$$\\fr|$$"],
    ["a table cell's own editor", "$\\fr|$"],
    ["a Formula auto-close just made", "$\\|$"],
    ["a Formula, after a space", "$x + \\|$"],
    ["after a row break", "$$\na \\\\ \\fr|\n$$"],
  ])("inside %s", (_where, marked) => {
    expect(popup(marked)).not.toBeNull();
  });
});

describe("the popup doesn't open", () => {
  test.each([
    ["outside a Formula", "Find \\fr| here."],
    ["after a Formula", "Find $x$ \\fr|"],
    ["on a row break", "$$\na \\\\|\n$$"],
    ["on a row break in an inline Formula", "$a \\\\|$"],
    ["before a dollar sign outside a Formula", "It costs \\|$5."],
  ])("%s", (_where, marked) => {
    expect(popup(marked)).toBeNull();
  });

  test("while the editor is read-only", () => {
    expect(popup("$\\fr|$", { readOnly: true })).toBeNull();
  });
});

describe("the popup's options", () => {
  test("narrow by the name's prefix, best first", () => {
    expect(labels(popup("$\\inf|$"))?.slice(0, 2)).toEqual(["\\inf", "\\infty"]);
    expect(labels(popup("$\\fr|$"))?.[0]).toBe("\\frac");
  });

  test("replace the whole command typed", () => {
    const result = popup("$x + \\fr|$");

    expect(result?.from).toBe(5);
  });

  test("show a snippet's slots as a hint, and none for a bare command", () => {
    const options = popup("$\\fr|$")?.options ?? [];
    const alpha = popup("$\\alph|$")?.options[0];

    expect(options.find(({ label }) => label === "\\frac")?.detail).toBe("{□}{□}");
    expect(alpha?.detail).toBeUndefined();
  });
});

describe("accepting a command", () => {
  test("inserts a snippet with the cursor in its first slot", () => {
    const editor = new Editor(side("$\\fr|$"));

    accept(editor, "\\frac");

    expect(shown(editor.state)).toBe("$\\frac{|}{}$");
  });

  test("Tab moves to the next slot, then past the snippet", () => {
    const editor = new Editor(side("$\\fr|$ and on"));
    accept(editor, "\\frac");

    type(editor, "a", false);
    tab(editor);
    expect(shown(editor.state)).toBe("$\\frac{a}{|}$ and on");

    type(editor, "b", false);
    tab(editor);
    expect(shown(editor.state)).toBe("$\\frac{a}{b}|$ and on");
    expect(tab(editor)).toBe(false);
  });

  test("Escape leaves the snippet", () => {
    const editor = new Editor(side("$\\fr|$"));
    accept(editor, "\\frac");

    expect(clearSnippet(editor)).toBe(true);
    expect(tab(editor)).toBe(false);
    expect(shown(editor.state)).toBe("$\\frac{|}{}$");
  });

  test("a command without arguments inserts only its name", () => {
    const editor = new Editor(side("$\\alph|$"));

    accept(editor, "\\alpha");

    expect(shown(editor.state)).toBe("$\\alpha|$");
    expect(tab(editor)).toBe(false);
  });

  test("an environment inserts its end and a first row", () => {
    const editor = new Editor(side("$$\n\\begin{pm|\n$$"));

    accept(editor, "\\begin{pmatrix}");

    expect(shown(editor.state)).toBe("$$\n\\begin{pmatrix} | &  \\\\ \\end{pmatrix}\n$$");
  });

  test("a brace delimiter keeps its backslashes", () => {
    const editor = new Editor(side("$\\left|$"));

    accept(editor, "\\left\\{");

    expect(shown(editor.state)).toBe("$\\left\\{ | \\right\\}$");
  });
});

describe("snippets with each auto-close choice", () => {
  test.each(["off", "brackets", "brackets-and-dollar"] as const)(
    "%s: typing in the slots adds nothing beyond them",
    (choice) => {
      const editor = new Editor(side("$\\fr|$", { choice }));
      const brackets = choice !== "off";
      accept(editor, "\\frac");

      type(editor, "a", brackets);
      tab(editor);
      type(editor, "b", brackets);
      tab(editor);

      expect(shown(editor.state)).toBe("$\\frac{a}{b}|$");
    },
  );

  test.each(["brackets", "brackets-and-dollar"] as const)(
    "%s: the `}` auto-close added after `\\begin{` isn't doubled",
    (choice) => {
      const editor = new Editor(side("$$\n|\n$$", { choice }));
      type(editor, "\\begin{pm", true);
      expect(shown(editor.state)).toBe("$$\n\\begin{pm|}\n$$");

      accept(editor, "\\begin{pmatrix}");

      expect(editor.state.doc.toString()).toBe("$$\n\\begin{pmatrix}  &  \\\\ \\end{pmatrix}\n$$");
    },
  );

  test("off: nothing after `\\begin{` is taken with the snippet", () => {
    const editor = new Editor(side("$$\n\\begin{pm|\n$$"));

    accept(editor, "\\begin{pmatrix}");

    expect(editor.state.doc.toString()).toBe("$$\n\\begin{pmatrix}  &  \\\\ \\end{pmatrix}\n$$");
  });

  test("brackets: a `{` typed in a slot is closed once", () => {
    const editor = new Editor(side("$\\sq|$", { choice: "brackets" }));
    accept(editor, "\\sqrt");

    type(editor, "x^{2}", true);

    expect(shown(editor.state)).toBe("$\\sqrt{x^{2}|}$");
  });
});

describe("inserting from the cheatsheet", () => {
  const frac = COMMANDS.find(({ name }) => name === "\\frac");
  const alpha = COMMANDS.find(({ name }) => name === "\\alpha");
  if (frac === undefined || alpha === undefined) throw new Error("Missing commands");

  test("inside a Formula, inserts the snippet at the cursor", () => {
    const editor = new Editor(side("$x + |y$"));

    insertAtCursor(editor.view, frac);

    expect(shown(editor.state)).toBe("$x + \\frac{|}{}y$");
  });

  test("outside a Formula, makes an inline Formula around it", () => {
    const editor = new Editor(side("So | is it."));

    insertAtCursor(editor.view, frac);
    expect(shown(editor.state)).toBe("So $\\frac{|}{}$ is it.");

    type(editor, "a", false);
    tab(editor);
    type(editor, "b", false);
    tab(editor);
    expect(shown(editor.state)).toBe("So $\\frac{a}{b}$| is it.");
  });

  test("outside a Formula, a command without arguments", () => {
    const editor = new Editor(side("Angle |"));

    insertAtCursor(editor.view, alpha);

    expect(shown(editor.state)).toBe("Angle $\\alpha$|");
    expect(insideFormula(editor.state, 8)).toBe(true);
  });

  test("inside a Formula auto-close just made", () => {
    const editor = new Editor(side("$|$"));

    insertAtCursor(editor.view, alpha);

    expect(editor.state.doc.toString()).toBe("$\\alpha$");
  });

  test("replaces a selection", () => {
    const state = side("$x + y$");
    const editor = new Editor(state.update({ selection: EditorSelection.range(5, 6) }).state);

    insertAtCursor(editor.view, alpha);

    expect(editor.state.doc.toString()).toBe("$x + \\alpha$");
  });

  test("does nothing while the editor is read-only", () => {
    const editor = new Editor(side("$x|$", { readOnly: true }));

    insertAtCursor(editor.view, alpha);

    expect(editor.state.doc.toString()).toBe("$x$");
  });
});

describe("the inline Formula's render while slots are empty", () => {
  test("shows each empty slot as a box", () => {
    expect(withSlotBoxes("\\frac{}{}")).toBe("\\frac{\\square}{\\square}");
  });

  test("keeps the source when the boxes don't typeset", () => {
    expect(withSlotBoxes("\\hspace{}")).toBe("\\hspace{}");
  });

  test("keeps a source with no empty slot", () => {
    expect(withSlotBoxes("\\frac{a}{b}")).toBe("\\frac{a}{b}");
  });
});
