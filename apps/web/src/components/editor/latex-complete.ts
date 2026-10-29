import {
  acceptCompletion,
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
  snippet,
} from "@codemirror/autocomplete";
import { type EditorState, type Extension, Prec } from "@codemirror/state";
import { type EditorView, keymap } from "@codemirror/view";
import { typeset } from "@/lib/formula";
import { formulaAt, formulaSource } from "./language";
import { type LatexCommand, matching, previewOf } from "./latex-commands";

// LaTeX autocomplete (BAN-21): a `\` typed inside a Formula opens a popup of
// the commands whose name starts with what follows it; accepting one inserts
// it as a snippet, its slots filled in with Tab. The cheatsheet inserts the
// same snippets at the cursor. Variant b: beside the list, a pane shows the
// whole Formula as it would be with the active command accepted.

/** Whether `pos` is inside a Formula's source, between its delimiters. */
export function insideFormula(state: EditorState, pos: number): boolean {
  const node = formulaAt(state, pos, -1) ?? formulaAt(state, pos, 1);
  if (node === null) return false;
  const marks = node.getChildren("FormulaMark");
  const start = marks[0]?.to ?? node.from;
  const end = marks.length >= 2 ? (marks[1]?.from ?? node.to) : node.to;
  return pos >= start && pos <= end;
}

/** A snippet as CodeMirror's template: each `▯` a field, and one at its end. */
function template(text: string): string {
  const escaped = text.replace(/\\([{}])/g, "\\\\$1");
  return escaped.includes("▯") ? `${escaped.replaceAll("▯", "${}")}\${}` : escaped;
}

/** Inserts `command` over `from`–`to` as a snippet, the cursor in its first slot. */
export function insertCommand(view: EditorView, command: LatexCommand, from: number, to: number) {
  snippet(template(command.snippet))(view, null, from, to);
}

/**
 * Inserts `command` at the cursor of `view`, from the cheatsheet: outside a
 * Formula, inside an inline Formula made around it, so it is always math.
 */
export function insertAtCursor(view: EditorView, command: LatexCommand) {
  if (view.state.readOnly) return;
  const { from, to } = view.state.selection.main;
  view.focus();
  if (insideFormula(view.state, from)) {
    insertCommand(view, command, from, to);
    return;
  }
  const inner = template(command.snippet).replace(/\$\{\}$/, "");
  snippet(`$${inner}$\${}`)(view, null, from, to);
}

/** The command each option stands for. */
const commandOf = new WeakMap<Completion, LatexCommand>();

export const optionCommand = (completion: Completion) => commandOf.get(completion);

/** The options, so each keeps its identity (and its render) as the popup narrows. */
const options = new Map<LatexCommand, Completion>();

function optionFor(command: LatexCommand): Completion {
  let option = options.get(command);
  if (option === undefined) {
    const rest = command.snippet.slice(command.name.length).replaceAll("▯", "□");
    option = {
      label: command.name,
      detail: rest.trim() === "" ? undefined : rest,
      info: infoFor,
      apply: (view, _completion, from, to) => {
        const typed = view.state.sliceDoc(from, to);
        // An auto-closed `}` after `\begin{…` isn't doubled.
        const end =
          typed.includes("{") && !typed.includes("}") && view.state.sliceDoc(to, to + 1) === "}"
            ? to + 1
            : to;
        insertCommand(view, command, from, end);
      },
    };
    options.set(command, option);
    commandOf.set(option, command);
  }
  return option;
}

/** The Formula being completed, and where the typed command sits in its source. */
let completing: { source: string; from: number; to: number; display: boolean } | null = null;

/** The Formula being completed as it would be with `command` accepted. */
function resultWith(command: LatexCommand): string {
  if (completing === null) return previewOf(command);
  const { source, from, to } = completing;
  return `${source.slice(0, from)}${previewOf(command)}${source.slice(to)}`;
}

/** The preview pane beside the list: the whole Formula with the active command in it. */
function infoFor(completion: Completion) {
  const command = commandOf.get(completion);
  if (command === undefined) return null;
  const dom = document.createElement("div");
  dom.className = "cm-latex-info";
  const label = document.createElement("span");
  label.className = "cm-latex-info-label";
  label.textContent = "Result";
  const render = document.createElement("div");
  render.className = "cm-latex-info-render";
  const result = typeset(resultWith(command), completing?.display ?? false);
  if ("html" in result) render.innerHTML = result.html;
  const meaning = document.createElement("p");
  meaning.className = "cm-latex-info-meaning";
  const name = document.createElement("code");
  name.textContent = command.snippet.replaceAll("▯", "□");
  meaning.append(name, document.createElement("br"), command.meaning);
  dom.append(label, render, meaning);
  return dom;
}

function latexSource(context: CompletionContext): CompletionResult | null {
  const { state, pos } = context;
  if (state.readOnly) return null;
  const word = context.matchBefore(/\\[a-zA-Z]*(\{[a-zA-Z*]*)?$/);
  if (word === null) return null;
  // `\\` is a row break: only an odd run of backslashes starts a command.
  let slashes = 0;
  while (
    word.from - slashes - 1 >= 0 &&
    state.sliceDoc(word.from - slashes - 1, word.from - slashes) === "\\"
  )
    slashes++;
  if (slashes % 2 === 1) return null;
  if (!insideFormula(state, pos)) return null;
  const found = matching(word.text);
  if (found.length === 0) return null;
  const node = formulaAt(state, pos, -1) ?? formulaAt(state, pos, 1);
  if (node !== null) {
    const start = node.getChildren("FormulaMark")[0]?.to ?? node.from;
    completing = {
      source: formulaSource(node, state.doc),
      from: word.from - start,
      to: pos - start,
      display: node.name !== "InlineFormula",
    };
  }
  return {
    from: word.from,
    options: found.map(optionFor),
    filter: false,
    getMatch: () => [0, word.text.length],
  };
}

/** A command's render, for a popup row. */
export function renderCommand(command: LatexCommand, className: string): HTMLElement {
  const el = document.createElement("span");
  el.className = className;
  el.setAttribute("aria-hidden", "true");
  const result = typeset(previewOf(command), false);
  if ("html" in result) el.innerHTML = result.html;
  return el;
}

/** The popup, in every editor: a side's and each table cell's. */
export function latexCompletion(): Extension {
  return [
    autocompletion({
      override: [latexSource],
      icons: false,
      activateOnTypingDelay: 0,
      maxRenderedOptions: 30,
      tooltipClass: () => "cm-latex-popup",
      optionClass: () => "cm-latex-option",
      addToOptions: [
        {
          position: 20,
          render: (completion) => {
            const command = commandOf.get(completion);
            return command === undefined ? null : renderCommand(command, "cm-latex-render");
          },
        },
        {
          position: 90,
          render: (completion) => {
            const command = commandOf.get(completion);
            if (command === undefined) return null;
            const el = document.createElement("span");
            el.className = "cm-latex-meaning";
            el.textContent = command.meaning;
            return el;
          },
        },
      ],
    }),
    Prec.highest(keymap.of([{ key: "Tab", run: acceptCompletion }])),
  ];
}
