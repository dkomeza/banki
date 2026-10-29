import type { AutoClose } from "@banki/shared";
import { insertBracket } from "@codemirror/autocomplete";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, test } from "vitest";
import { autoCloseExtension, insertDollar } from "./auto-close";
import { cardLanguage } from "./language";

/** A side with the auto-close `choice`, holding `doc` with `|` for the cursor. */
function side(choice: AutoClose, marked: string) {
  return EditorState.create({
    doc: marked.replace("|", ""),
    selection: EditorSelection.cursor(marked.indexOf("|")),
    extensions: [cardLanguage, autoCloseExtension(choice)],
  });
}

const shown = (state: EditorState) => {
  const head = state.selection.main.head;
  const text = state.doc.toString();
  return `${text.slice(0, head)}|${text.slice(head)}`;
};

/** Types `text` a character at a time, as the editor's input handlers would. */
function type(state: EditorState, text: string, dollars: boolean): EditorState {
  let next = state;
  for (const char of text) {
    const tr =
      char === "$" && dollars
        ? insertDollar(next)
        : char === "$"
          ? null
          : insertBracket(next, char);
    next = (
      tr ??
      next.update({
        changes: { from: next.selection.main.from, to: next.selection.main.to, insert: char },
        selection: EditorSelection.cursor(next.selection.main.from + char.length),
      })
    ).state;
  }
  return next;
}

describe("auto-close: brackets", () => {
  test.each(["(", "[", "{"])("closes %s", (bracket) => {
    const after = type(side("brackets", "x |"), bracket, false);

    expect(shown(after)).toMatch(/^x [([{]\|[)\]}]$/);
  });

  test("steps over the bracket it added", () => {
    expect(shown(type(side("brackets", "|"), String.raw`\frac{1}{2}`, false))).toBe(
      String.raw`\frac{1}{2}|`,
    );
  });

  test("closes no quotes, which Markdown would", () => {
    expect(shown(type(side("brackets", "|"), '"', false))).toBe('"|');
  });

  test("leaves `$` alone", () => {
    expect(shown(type(side("brackets", "|"), "$", false))).toBe("$|");
  });
});

describe("auto-close: brackets and $", () => {
  test("typing $ inserts $$ with the cursor between", () => {
    expect(shown(type(side("brackets-and-dollar", "Area |"), "$", true))).toBe("Area $|$");
  });

  test("typing $ just before the $ it added steps over it", () => {
    expect(shown(type(side("brackets-and-dollar", "|"), "$x^2$ ok", true))).toBe("$x^2$ ok|");
  });

  test("typing $ before a $ the User typed inserts a pair", () => {
    const typed = side("brackets-and-dollar", "|$");

    expect(shown(type(typed, "$", true))).toBe("$|$$");
  });

  test("leaves an escaped \\$ as typed", () => {
    expect(shown(type(side("brackets-and-dollar", String.raw`costs \|`), "$", true))).toBe(
      String.raw`costs \$|`,
    );
  });

  test("wraps a selection in $s", () => {
    const state = EditorState.create({
      doc: "x^2",
      selection: EditorSelection.range(0, 3),
      extensions: [cardLanguage, autoCloseExtension("brackets-and-dollar")],
    });

    expect(insertDollar(state)?.state.doc.toString()).toBe("$x^2$");
  });
});

/** How many input handlers a side with auto-close `choice` has. */
const handlers = (choice: AutoClose) => side(choice, "|").facet(EditorView.inputHandler).length;

describe("auto-close: off", () => {
  test("leaves typing alone: nothing handles it", () => {
    // The Markdown mode's own, for HTML tags, is there whatever the choice.
    const own = EditorState.create({ extensions: cardLanguage }).facet(
      EditorView.inputHandler,
    ).length;

    expect(handlers("off")).toBe(own);
    expect(handlers("brackets")).toBe(own + 1);
    expect(handlers("brackets-and-dollar")).toBe(own + 2);
  });
});
