import { type CardNode, Formula } from "@banki/shared";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentLess,
  indentMore,
  redo,
  undo,
} from "@codemirror/commands";
import { commonmarkLanguage, markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree, indentUnit, syntaxTree } from "@codemirror/language";
import {
  Annotation,
  EditorSelection,
  EditorState,
  type Extension,
  type Range,
  StateEffect,
  StateField,
  type Text,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  type KeyBinding,
  keymap,
  placeholder as placeholderExt,
  showTooltip,
  type Tooltip,
  tooltips,
  WidgetType,
} from "@codemirror/view";
import { Strikethrough, Table } from "@lezer/markdown";
import { typeset } from "@/lib/formula";
import { type Align, formatTable, parseTable, storedCell, type TableModel } from "./table";
import { protoFocus } from "./proto-state";

// Prototype of BAN-19's live-preview editor: CodeMirror 6 on the Markdown
// source, decorated from the Card parser's tree (ADR-0004, ADR-0020).
// Formulas and marks render while the cursor is outside them and show their
// source while it is in them; a table is an editable grid of one-line cell
// editors that writes the whole table back padded (ADR-0022).
//
// Throwaway Variant code: the implement Stage rebuilds it with tests.

// ——— Language: the Card parser's own configuration ———

const cardMarkdown = markdown({
  base: commonmarkLanguage,
  extensions: [Table, Strikethrough, Formula, { remove: ["HTMLBlock", "Entity"] }],
  completeHTMLTags: false,
  pasteURLAsLink: false,
});

// ——— Focus: the source shows only in the focused editor ———

const setFocus = StateEffect.define<boolean>();

const focusField = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setFocus)) value = effect.value;
    return value;
  },
});

const focusTracker = EditorView.focusChangeEffect.of((_state, focused) => setFocus.of(focused));

const FORMULAS = new Set(["InlineFormula", "DisplayFormula", "DisplayFormulaBlock"]);

/** A Formula's source: the text between its delimiters. */
function formulaSource(node: CardNode, doc: Text): string {
  const marks = node.getChildren("FormulaMark");
  const from = marks[0]?.to ?? node.from;
  const to = marks[1]?.from ?? node.to;
  return doc
    .sliceString(from, to)
    .split("\n")
    .map((line, i) => (i === 0 ? line : line.replace(/^\s*>\s?/, "")))
    .join("\n");
}

function treeOf(state: EditorState) {
  return ensureSyntaxTree(state, state.doc.length, 500) ?? syntaxTree(state);
}

/** The Formula at `pos`, if any. */
function formulaAt(state: EditorState, pos: number, side: -1 | 1): CardNode | null {
  for (let node: CardNode | null = treeOf(state).resolveInner(pos, side); node; node = node.parent) {
    if (FORMULAS.has(node.name)) return node;
  }
  return null;
}

// ——— Widgets ———

function renderFormula(el: HTMLElement, source: string, display: boolean, delimiter: string) {
  const result = typeset(source, display);
  if ("error" in result) {
    el.classList.add("cm-lp-broken");
    const src = document.createElement("span");
    src.className = "cm-lp-broken-source";
    src.textContent = `${delimiter}${source}${delimiter}`;
    const message = document.createElement("span");
    message.className = "cm-lp-broken-message";
    message.textContent = result.error;
    el.append(src, " ", message);
  } else {
    el.innerHTML = result.html;
  }
}

class FormulaWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly display: boolean,
    readonly block: boolean,
  ) {
    super();
  }
  override eq(other: FormulaWidget) {
    return (
      other.source === this.source && other.display === this.display && other.block === this.block
    );
  }
  toDOM() {
    const el = document.createElement(this.block ? "div" : "span");
    el.className = `cm-lp-formula ${this.display ? "cm-lp-formula-display" : "cm-lp-formula-inline"}`;
    renderFormula(el, this.source, this.display, this.display ? "$$" : "$");
    return el;
  }
  override ignoreEvent() {
    return false;
  }
}

/** A display Formula's render right under its source while it is edited. */
class LiveDisplayWidget extends WidgetType {
  constructor(readonly source: string) {
    super();
  }
  override eq(other: LiveDisplayWidget) {
    return other.source === this.source;
  }
  toDOM() {
    const el = document.createElement("div");
    el.className = "cm-lp-live";
    el.setAttribute("aria-hidden", "true");
    const result = typeset(this.source, true);
    if ("error" in result) {
      el.classList.add("cm-lp-live-error");
      el.textContent = result.error;
    } else {
      const inner = document.createElement("div");
      inner.className = "cm-lp-live-render";
      inner.innerHTML = result.html;
      el.append(inner);
    }
    return el;
  }
}

class BulletWidget extends WidgetType {
  override eq() {
    return true;
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = "cm-lp-bullet";
    el.textContent = "•";
    return el;
  }
}

const hidden = Decoration.replace({});
const sourceMark = Decoration.mark({
  class: "cm-lp-formula-source",
  attributes: { spellcheck: "false" },
});
const mark = (cls: string, attributes?: Record<string, string>) =>
  Decoration.mark({ class: cls, attributes });
const line = (cls: string) => Decoration.line({ class: cls });

// ——— Decorations ———

function build(state: EditorState, blocks: boolean): DecorationSet {
  const doc = state.doc;
  const focused = state.field(focusField, false) ?? false;
  const touches = (from: number, to: number) =>
    focused && state.selection.ranges.some((r) => r.from <= to && r.to >= from);
  const out: Range<Decoration>[] = [];
  const hide = (from: number, to: number) => {
    if (to > from) out.push(hidden.range(from, to));
  };
  const hideChildren = (node: CardNode, names: readonly string[]) => {
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (names.includes(child.name)) hide(child.from, child.to);
    }
  };
  const eachLine = (from: number, to: number, fn: (l: { from: number; to: number }, i: number, last: boolean) => void) => {
    const first = doc.lineAt(from).number;
    const end = doc.lineAt(to).number;
    for (let n = first; n <= end; n++) fn(doc.line(n), n - first, n === end);
  };

  treeOf(state).iterate({
    enter(ref) {
      const node = ref.node;
      switch (node.name) {
        case "InlineFormula":
        case "DisplayFormula": {
          const source = formulaSource(node, doc);
          const display = node.name === "DisplayFormula";
          if (touches(node.from, node.to)) {
            out.push(sourceMark.range(node.from, node.to));
            if (display && blocks) {
              out.push(
                Decoration.widget({ widget: new LiveDisplayWidget(source), block: true, side: 1 }).range(
                  doc.lineAt(node.to).to,
                ),
              );
            }
          } else {
            out.push(
              Decoration.replace({ widget: new FormulaWidget(source, display, false) }).range(
                node.from,
                node.to,
              ),
            );
          }
          return false;
        }
        case "DisplayFormulaBlock": {
          if (!blocks) return false;
          const source = formulaSource(node, doc);
          const from = doc.lineAt(node.from).from;
          const to = doc.lineAt(node.to).to;
          if (touches(node.from, node.to)) {
            eachLine(from, to, (l) => out.push(line("cm-lp-formula-source-line").range(l.from)));
            out.push(sourceMark.range(node.from, node.to));
            out.push(
              Decoration.widget({ widget: new LiveDisplayWidget(source), block: true, side: 1 }).range(to),
            );
          } else {
            out.push(
              Decoration.replace({ widget: new FormulaWidget(source, true, true), block: true }).range(
                from,
                to,
              ),
            );
          }
          return false;
        }
        case "Emphasis":
          out.push(mark("cm-lp-em").range(node.from, node.to));
          if (!touches(node.from, node.to)) hideChildren(node, ["EmphasisMark"]);
          return;
        case "StrongEmphasis":
          out.push(mark("cm-lp-strong").range(node.from, node.to));
          if (!touches(node.from, node.to)) hideChildren(node, ["EmphasisMark"]);
          return;
        case "Strikethrough":
          out.push(mark("cm-lp-strike").range(node.from, node.to));
          if (!touches(node.from, node.to)) hideChildren(node, ["StrikethroughMark"]);
          return;
        case "InlineCode":
          out.push(mark("cm-lp-code", { spellcheck: "false" }).range(node.from, node.to));
          if (!touches(node.from, node.to)) hideChildren(node, ["CodeMark"]);
          return false;
        case "Link":
          if (!touches(node.from, node.to)) {
            hideChildren(node, ["LinkMark", "URL", "LinkTitle"]);
            const label = node.getChildren("LinkMark");
            if (label.length >= 2) {
              out.push(mark("cm-lp-link").range(label[0]!.to, label[1]!.from));
            }
          } else out.push(mark("cm-lp-link").range(node.from, node.to));
          return false;
        case "ATXHeading1":
        case "ATXHeading2":
        case "ATXHeading3":
        case "ATXHeading4":
        case "ATXHeading5":
        case "ATXHeading6": {
          out.push(line("cm-lp-heading").range(doc.lineAt(node.from).from));
          if (!touches(node.from, node.to)) {
            const headerMark = node.getChild("HeaderMark");
            if (headerMark) hide(headerMark.from, Math.min(headerMark.to + 1, node.to));
          }
          return;
        }
        case "FencedCode": {
          if (!blocks) return false;
          const open = touches(node.from, node.to);
          eachLine(node.from, node.to, (l, i, last) => {
            const fence = i === 0 || (last && /^\s*(```|~~~)/.test(doc.sliceString(l.from, l.to)));
            if (fence && !open) {
              out.push(Decoration.replace({ block: true }).range(l.from, l.to));
              return;
            }
            const classes = ["cm-lp-codeblock"];
            if (i === 0 || (i === 1 && !open)) classes.push("cm-lp-codeblock-first");
            if (last || (!open && i > 0 && doc.lineAt(node.to).number - 1 === doc.lineAt(l.from).number))
              classes.push("cm-lp-codeblock-last");
            out.push(line(classes.join(" ")).range(l.from));
          });
          out.push(mark("cm-lp-codeblock-text", { spellcheck: "false" }).range(node.from, node.to));
          return false;
        }
        case "Blockquote":
          eachLine(node.from, node.to, (l) => out.push(line("cm-lp-quote").range(l.from)));
          return;
        case "QuoteMark": {
          const l = doc.lineAt(node.from);
          if (!touches(l.from, l.to)) {
            const space = doc.sliceString(node.to, node.to + 1) === " " ? 1 : 0;
            hide(node.from, node.to + space);
          }
          return;
        }
        case "ListMark": {
          const text = doc.sliceString(node.from, node.to);
          if ("-*+".includes(text) && !touches(node.from, node.to)) {
            out.push(Decoration.replace({ widget: new BulletWidget() }).range(node.from, node.to));
          }
          return;
        }
        case "Table": {
          if (!blocks) return false;
          const from = doc.lineAt(node.from).from;
          const to = doc.lineAt(node.to).to;
          out.push(
            Decoration.replace({
              widget: new TableWidget(doc.sliceString(from, to)),
              block: true,
            }).range(from, to),
          );
          return false;
        }
        default:
          return;
      }
    },
  });
  return Decoration.set(out, true);
}

function decorationField(blocks: boolean) {
  return StateField.define<DecorationSet>({
    create: (state) => build(state, blocks),
    update(value, tr) {
      if (tr.docChanged || tr.selection || tr.effects.some((e) => e.is(setFocus))) {
        return build(tr.state, blocks);
      }
      return value;
    },
    provide: (field) => EditorView.decorations.from(field),
  });
}

// ——— The inline Formula's popover ———

function popoverFor(state: EditorState): Tooltip | null {
  if (!state.field(focusField, false)) return null;
  const head = state.selection.main.head;
  const node = formulaAt(state, head, -1) ?? formulaAt(state, head, 1);
  if (!node || node.name !== "InlineFormula") return null;
  const source = formulaSource(node, state.doc);
  return {
    pos: node.from,
    above: false,
    arrow: true,
    create: () => {
      const dom = document.createElement("div");
      dom.className = "cm-lp-popover card-text";
      dom.setAttribute("aria-hidden", "true");
      const result = typeset(source, false);
      if ("error" in result) {
        dom.classList.add("cm-lp-popover-error");
        dom.textContent = result.error;
      } else if (source.trim() === "") {
        dom.classList.add("cm-lp-popover-empty");
        dom.textContent = "Type LaTeX";
      } else dom.innerHTML = result.html;
      return { dom };
    },
  };
}

const popoverField = StateField.define<Tooltip | null>({
  create: popoverFor,
  update(value, tr) {
    if (tr.docChanged || tr.selection || tr.effects.some((e) => e.is(setFocus))) {
      return popoverFor(tr.state);
    }
    return value;
  },
  provide: (field) => showTooltip.from(field),
});

/** Clicking a rendered Formula puts the cursor at the end of its source. */
const formulaClicks = EditorView.domEventHandlers({
  mousedown(event, view) {
    const target = event.target instanceof Element ? event.target.closest(".cm-lp-formula") : null;
    if (!(target instanceof HTMLElement)) return false;
    const pos = view.posAtDOM(target);
    const node = formulaAt(view.state, pos, 1);
    if (!node) return false;
    const end = node.lastChild?.name === "FormulaMark" ? node.lastChild.from : node.to;
    event.preventDefault();
    view.focus();
    view.dispatch({ selection: { anchor: end } });
    return true;
  },
});

// ——— Formatting ———

/** Wraps each selection in `before`/`after`, or puts the cursor between new markers. */
export function wrap(view: EditorView, before: string, after = before): boolean {
  if (view.state.readOnly) return false;
  view.dispatch(
    view.state.changeByRange((range) =>
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
            range: EditorSelection.range(range.from + before.length, range.to + before.length),
          },
    ),
    { userEvent: "input.format" },
  );
  view.focus();
  return true;
}

/** Starts each selected line with a list marker. */
export function list(view: EditorView, ordered: boolean): boolean {
  const { state } = view;
  const changes: { from: number; insert: string }[] = [];
  const seen = new Set<number>();
  let n = 1;
  for (const range of state.selection.ranges) {
    for (let pos = range.from; pos <= range.to; ) {
      const l = state.doc.lineAt(pos);
      if (!seen.has(l.number)) {
        seen.add(l.number);
        changes.push({ from: l.from, insert: ordered ? `${n++}. ` : "- " });
      }
      pos = l.to + 1;
    }
  }
  view.dispatch({ changes, userEvent: "input.format" });
  view.focus();
  return true;
}

/** Puts `before`, a line for the cursor, and `after` on lines of their own. */
export function block(view: EditorView, before: string, after: string, middle = ""): number {
  const { state } = view;
  const { from, to } = state.selection.main;
  const l = state.doc.lineAt(from);
  const lead = from === l.from ? "" : "\n";
  const selected = state.sliceDoc(from, to) || middle;
  const insert = `${lead}${before}\n${selected}\n${after}`;
  const cursor = from + lead.length + before.length + 1 + selected.length;
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: cursor },
    userEvent: "input.format",
  });
  view.focus();
  return from + lead.length;
}

/** Inserts a two-column table, the cursor in its first header cell. */
export function insertTable(view: EditorView): boolean {
  const { state } = view;
  const { from, to } = state.selection.main;
  const lead = from === state.doc.lineAt(from).from ? "" : "\n";
  const table = "|     |     |\n| --- | --- |\n|     |     |";
  const at = from + lead.length;
  view.dispatch({
    changes: { from, to, insert: `${lead}${table}\n` },
    selection: { anchor: at + table.length + 1 },
    userEvent: "input.format",
  });
  requestAnimationFrame(() => gridAt(view, at)?.focusCell(0, 0));
  return true;
}

export const formatting = {
  bold: (view: EditorView) => wrap(view, "**"),
  italic: (view: EditorView) => wrap(view, "*"),
  code: (view: EditorView) => wrap(view, "`"),
  formula: (view: EditorView) => wrap(view, "$"),
  displayFormula: (view: EditorView) => (block(view, "$$", "$$"), true),
  codeBlock: (view: EditorView) => (block(view, "```", "```"), true),
  bulleted: (view: EditorView) => list(view, false),
  numbered: (view: EditorView) => list(view, true),
  table: insertTable,
};

const formattingKeymap: KeyBinding[] = [
  { key: "Mod-b", run: formatting.bold },
  { key: "Mod-i", run: formatting.italic },
  { key: "Mod-e", run: formatting.code },
  { key: "Mod-m", run: formatting.formula },
];

// ——— Tables ———

const fromGrid = Annotation.define<boolean>();
const grids = new WeakMap<HTMLElement, TableGrid>();

/** The grid of the table that starts on the line at `pos`. */
function gridAt(view: EditorView, pos: number): TableGrid | undefined {
  for (const el of view.contentDOM.querySelectorAll<HTMLElement>(".cm-lp-table-wrap")) {
    const grid = grids.get(el);
    const range = grid?.locate();
    if (grid && range && range.from <= pos && pos <= range.to) return grid;
  }
  return undefined;
}

class TableWidget extends WidgetType {
  constructor(readonly source: string) {
    super();
  }
  override eq(other: TableWidget) {
    return other.source === this.source;
  }
  toDOM(view: EditorView) {
    return new TableGrid(view, this.source).dom;
  }
  override updateDOM(dom: HTMLElement) {
    const grid = grids.get(dom);
    if (!grid) return false;
    grid.sync(this.source);
    return true;
  }
  override ignoreEvent() {
    return true;
  }
}

type MenuItem = { label: string; run: (r: number, c: number) => void; disabled?: (r: number, c: number) => boolean } | "separator";

class TableGrid {
  readonly dom: HTMLElement;
  private table: HTMLTableElement;
  private cells: EditorView[][] = [];
  private model: TableModel;
  private current = { r: 0, c: 0 };
  private menuButton: HTMLButtonElement;
  private menu: HTMLElement | null = null;
  private syncing = false;

  constructor(
    readonly outer: EditorView,
    source: string,
  ) {
    this.model = parseTable(source);
    this.dom = document.createElement("div");
    this.dom.className = "cm-lp-table-wrap";
    const scroller = document.createElement("div");
    scroller.className = "cm-lp-table-scroll";
    this.table = document.createElement("table");
    this.table.className = "cm-lp-table";
    scroller.append(this.table);
    this.menuButton = document.createElement("button");
    this.menuButton.type = "button";
    this.menuButton.className = "cm-lp-table-menu-button";
    this.menuButton.setAttribute("aria-haspopup", "menu");
    this.menuButton.setAttribute("aria-expanded", "false");
    this.menuButton.setAttribute("aria-label", "Table options");
    this.menuButton.innerHTML =
      '<svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>';
    this.menuButton.addEventListener("mousedown", (e) => e.preventDefault());
    this.menuButton.addEventListener("click", () => (this.menu ? this.closeMenu() : this.openMenu()));
    this.dom.append(this.menuButton, scroller);
    grids.set(this.dom, this);
    this.render();
    const pending = protoFocus.table;
    if (pending) {
      setTimeout(() => {
        // Dev's StrictMode builds the editor twice: the one still on the page claims it.
        if (pending.claimed || !this.dom.isConnected) return;
        pending.claimed = true;
        this.focusCell(pending.r, pending.c, pending.offset);
        if (pending.menu) this.openMenu(false);
      }, 120);
    }
  }

  get rowCount() {
    return this.model.rows.length;
  }

  /** The table's range in the outer document. */
  locate(): { from: number; to: number } | null {
    if (!this.dom.isConnected) return null;
    let pos: number;
    try {
      pos = this.outer.posAtDOM(this.dom);
    } catch {
      return null;
    }
    const doc = this.outer.state.doc;
    for (let node: CardNode | null = treeOf(this.outer.state).resolveInner(pos, 1); node; node = node.parent) {
      if (node.name === "Table") return { from: doc.lineAt(node.from).from, to: doc.lineAt(node.to).to };
    }
    return null;
  }

  private render() {
    for (const row of this.cells) for (const cell of row) cell.destroy();
    this.cells = [];
    this.table.replaceChildren();
    const thead = document.createElement("thead");
    const tbody = document.createElement("tbody");
    this.model.rows.forEach((row, r) => {
      const tr = document.createElement("tr");
      const views: EditorView[] = [];
      row.forEach((text, c) => {
        const cell = document.createElement(r === 0 ? "th" : "td");
        cell.className = "cm-lp-cell";
        const align = this.model.aligns[c];
        if (align) cell.style.textAlign = align;
        if (r === 0) cell.scope = "col";
        tr.append(cell);
        views.push(this.cellEditor(cell, text, r, c));
      });
      this.cells.push(views);
      (r === 0 ? thead : tbody).append(tr);
    });
    this.table.append(thead, tbody);
  }

  private cellEditor(parent: HTMLElement, text: string, r: number, c: number): EditorView {
    const grid = this;
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: text,
        extensions: [
          cardMarkdown,
          focusField,
          focusTracker,
          decorationField(false),
          popoverField,
          tooltips({ position: "absolute" }),
          EditorView.contentAttributes.of({
            spellcheck: "true",
            "aria-label": r === 0 ? `Header ${c + 1}` : `Row ${r}, column ${c + 1}`,
            "aria-multiline": "false",
          }),
          EditorState.readOnly.of(this.outer.state.readOnly),
          EditorState.transactionFilter.of((tr) =>
            tr.newDoc.toString().includes("\n") ? [] : tr,
          ),
          keymap.of([
            { key: "Tab", run: () => grid.step(1) },
            { key: "Shift-Tab", run: () => grid.step(-1) },
            { key: "Enter", run: () => grid.down() },
            { key: "ArrowDown", run: () => grid.vertical(1) },
            { key: "ArrowUp", run: () => grid.vertical(-1) },
            { key: "Escape", run: () => grid.leave() },
            { key: "Mod-z", run: () => undo(grid.outer) },
            { key: "Mod-Shift-z", run: () => redo(grid.outer) },
            ...formattingKeymap,
          ]),
          EditorView.updateListener.of((update) => {
            if (update.focusChanged && update.view.hasFocus) {
              grid.current = { r, c };
              grid.markActive();
            }
            if (update.focusChanged && !update.view.hasFocus) grid.markActive();
            if (update.docChanged && !grid.syncing) grid.cellChanged(r, c, update.state.doc.toString());
          }),
        ],
      }),
    });
    return view;
  }

  private markActive() {
    this.cells.forEach((row, r) =>
      row.forEach((view, c) => {
        const active = view.hasFocus || (this.menu !== null && r === this.current.r && c === this.current.c);
        view.dom.parentElement?.classList.toggle("cm-lp-cell-active", active);
      }),
    );
  }

  /** Brings the grid in line with the table's source after the outer document changed. */
  sync(source: string) {
    const next = parseTable(source);
    const sameShape =
      next.rows.length === this.model.rows.length &&
      next.aligns.length === this.model.aligns.length &&
      next.aligns.every((a, i) => a === this.model.aligns[i]);
    this.model = next;
    if (!sameShape) {
      this.render();
      return;
    }
    this.syncing = true;
    next.rows.forEach((row, r) =>
      row.forEach((text, c) => {
        const view = this.cells[r]?.[c];
        if (view && view.state.doc.toString() !== text) {
          view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
        }
      }),
    );
    this.syncing = false;
  }

  private write(model: TableModel) {
    const range = this.locate();
    if (!range) return;
    this.model = model;
    this.outer.dispatch({
      changes: { from: range.from, to: range.to, insert: formatTable(model) },
      annotations: fromGrid.of(true),
      userEvent: "input.table",
    });
  }

  private cellChanged(r: number, c: number, text: string) {
    const stored = storedCell(text);
    const rows = this.model.rows.map((row) => [...row]);
    rows[r]![c] = stored;
    this.write({ rows, aligns: [...this.model.aligns] });
    if (stored !== text) {
      const view = this.cells[r]![c]!;
      const head = view.state.selection.main.head + (stored.length - text.length);
      this.syncing = true;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: stored }, selection: { anchor: head } });
      this.syncing = false;
    }
  }

  focusCell(r: number, c: number, offset?: number) {
    const view = this.cells[r]?.[c];
    if (!view) return;
    this.current = { r, c };
    view.focus();
    const at = offset ?? view.state.doc.length;
    view.dispatch({ selection: { anchor: Math.min(at, view.state.doc.length) } });
  }

  private restructure(model: TableModel, focus: { r: number; c: number }) {
    this.write(model);
    this.render();
    requestAnimationFrame(() => this.focusCell(focus.r, focus.c));
  }

  private emptyRow = () => this.model.aligns.map(() => "");

  private step(direction: 1 | -1): boolean {
    const width = this.model.aligns.length;
    const index = this.current.r * width + this.current.c + direction;
    if (index < 0) return true;
    if (index >= this.model.rows.length * width) {
      const rows = [...this.model.rows, this.emptyRow()];
      this.restructure({ rows, aligns: this.model.aligns }, { r: rows.length - 1, c: 0 });
      return true;
    }
    this.focusCell(Math.floor(index / width), index % width);
    return true;
  }

  private down(): boolean {
    const { r, c } = this.current;
    if (r + 1 >= this.model.rows.length) {
      const rows = [...this.model.rows, this.emptyRow()];
      this.restructure({ rows, aligns: this.model.aligns }, { r: rows.length - 1, c });
    } else this.focusCell(r + 1, c);
    return true;
  }

  private vertical(direction: 1 | -1): boolean {
    const { r, c } = this.current;
    const next = r + direction;
    if (next >= 0 && next < this.model.rows.length) {
      this.focusCell(next, c);
      return true;
    }
    const range = this.locate();
    if (!range) return false;
    const doc = this.outer.state.doc;
    if (direction < 0) {
      const above = doc.lineAt(range.from).number - 1;
      this.outer.focus();
      if (above >= 1) this.outer.dispatch({ selection: { anchor: doc.line(above).to } });
      else this.outer.dispatch({ changes: { from: 0, insert: "\n" }, selection: { anchor: 0 } });
      return true;
    }
    return this.leave();
  }

  /** Puts the cursor on the line after the table. */
  private leave(): boolean {
    const range = this.locate();
    if (!range) return false;
    const doc = this.outer.state.doc;
    const lineNo = doc.lineAt(range.to).number;
    this.outer.focus();
    if (lineNo < doc.lines) this.outer.dispatch({ selection: { anchor: doc.line(lineNo + 1).from } });
    else
      this.outer.dispatch({
        changes: { from: range.to, insert: "\n" },
        selection: { anchor: range.to + 1 },
      });
    return true;
  }

  // ——— The ⋯ menu ———

  private items(): MenuItem[] {
    const m = () => this.model;
    const rowsWith = (fn: (rows: string[][]) => void) => {
      const rows = m().rows.map((row) => [...row]);
      fn(rows);
      return rows;
    };
    const align = (value: Align) => (_r: number, c: number) => {
      const aligns = [...m().aligns];
      aligns[c] = value;
      this.restructure({ rows: m().rows, aligns }, this.current);
    };
    return [
      {
        label: "Add row above",
        disabled: (r) => r === 0,
        run: (r, c) => this.restructure({ rows: rowsWith((rows) => rows.splice(r, 0, this.emptyRow())), aligns: m().aligns }, { r, c }),
      },
      {
        label: "Add row below",
        run: (r, c) => this.restructure({ rows: rowsWith((rows) => rows.splice(r + 1, 0, this.emptyRow())), aligns: m().aligns }, { r: r + 1, c }),
      },
      {
        label: "Add column left",
        run: (r, c) =>
          this.restructure(
            { rows: rowsWith((rows) => rows.forEach((row) => row.splice(c, 0, ""))), aligns: [...m().aligns.slice(0, c), null, ...m().aligns.slice(c)] },
            { r, c },
          ),
      },
      {
        label: "Add column right",
        run: (r, c) =>
          this.restructure(
            { rows: rowsWith((rows) => rows.forEach((row) => row.splice(c + 1, 0, ""))), aligns: [...m().aligns.slice(0, c + 1), null, ...m().aligns.slice(c + 1)] },
            { r, c: c + 1 },
          ),
      },
      "separator",
      {
        label: "Move row up",
        disabled: (r) => r <= 1,
        run: (r, c) => this.restructure({ rows: rowsWith((rows) => rows.splice(r - 1, 2, rows[r]!, rows[r - 1]!)), aligns: m().aligns }, { r: r - 1, c }),
      },
      {
        label: "Move row down",
        disabled: (r) => r === 0 || r >= m().rows.length - 1,
        run: (r, c) => this.restructure({ rows: rowsWith((rows) => rows.splice(r, 2, rows[r + 1]!, rows[r]!)), aligns: m().aligns }, { r: r + 1, c }),
      },
      {
        label: "Move column left",
        disabled: (_r, c) => c === 0,
        run: (r, c) => {
          const aligns = [...m().aligns];
          aligns.splice(c - 1, 2, aligns[c]!, aligns[c - 1]!);
          this.restructure({ rows: rowsWith((rows) => rows.forEach((row) => row.splice(c - 1, 2, row[c]!, row[c - 1]!))), aligns }, { r, c: c - 1 });
        },
      },
      {
        label: "Move column right",
        disabled: (_r, c) => c >= m().aligns.length - 1,
        run: (r, c) => {
          const aligns = [...m().aligns];
          aligns.splice(c, 2, aligns[c + 1]!, aligns[c]!);
          this.restructure({ rows: rowsWith((rows) => rows.forEach((row) => row.splice(c, 2, row[c + 1]!, row[c]!))), aligns }, { r, c: c + 1 });
        },
      },
      "separator",
      { label: "Align column left", run: align("left") },
      { label: "Align column center", run: align("center") },
      { label: "Align column right", run: align("right") },
      "separator",
      {
        label: "Delete row",
        disabled: (r) => r === 0,
        run: (r, c) => this.restructure({ rows: rowsWith((rows) => rows.splice(r, 1)), aligns: m().aligns }, { r: Math.min(r, m().rows.length - 2), c }),
      },
      {
        label: "Delete column",
        disabled: () => m().aligns.length <= 1,
        run: (r, c) =>
          this.restructure(
            { rows: rowsWith((rows) => rows.forEach((row) => row.splice(c, 1))), aligns: m().aligns.filter((_, i) => i !== c) },
            { r, c: Math.max(0, c - 1) },
          ),
      },
      {
        label: "Delete table",
        run: () => {
          const range = this.locate();
          this.closeMenu(false);
          if (!range) return;
          const doc = this.outer.state.doc;
          const to = Math.min(range.to + 1, doc.length);
          this.outer.focus();
          this.outer.dispatch({ changes: { from: range.from, to }, selection: { anchor: range.from } });
        },
      },
    ];
  }

  openMenu(focusFirst = true) {
    this.closeMenu(false);
    const menu = document.createElement("div");
    menu.className = "cm-lp-table-menu";
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", "Table options");
    const { r, c } = this.current;
    const buttons: HTMLButtonElement[] = [];
    for (const item of this.items()) {
      if (item === "separator") {
        const sep = document.createElement("div");
        sep.setAttribute("role", "separator");
        sep.className = "cm-lp-table-menu-separator";
        menu.append(sep);
        continue;
      }
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("role", "menuitem");
      button.className = "cm-lp-table-menu-item";
      if (item.label.startsWith("Delete")) button.classList.add("cm-lp-danger");
      button.textContent = item.label;
      const disabled = item.disabled?.(r, c) ?? false;
      if (disabled) button.setAttribute("aria-disabled", "true");
      button.tabIndex = -1;
      button.addEventListener("mousedown", (e) => e.preventDefault());
      button.addEventListener("click", () => {
        if (disabled) return;
        this.closeMenu(false);
        item.run(r, c);
      });
      buttons.push(button);
      menu.append(button);
    }
    menu.addEventListener("keydown", (event) => {
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const next = (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
      } else if (event.key === "Escape") {
        event.preventDefault();
        this.closeMenu();
      } else if (event.key === "Tab") this.closeMenu(false);
    });
    this.menu = menu;
    // On the page, not in the editor, whose scroller is a stacking context of its own.
    document.body.append(menu);
    const place = () => {
      const rect = this.menuButton.getBoundingClientRect();
      const width = menu.offsetWidth;
      const right = rect.left + rect.width / 2 > window.innerWidth / 2;
      menu.style.top = `${rect.bottom + window.scrollY + 6}px`;
      menu.style.left = `${Math.max(8, (right ? rect.right - width : rect.left) + window.scrollX)}px`;
    };
    place();
    menu.dataset.side = this.menuButton.getBoundingClientRect().left > window.innerWidth / 2 ? "right" : "left";
    this.dom.classList.add("cm-lp-menu-open");
    this.menuButton.setAttribute("aria-expanded", "true");
    this.markActive();
    if (focusFirst) buttons[0]?.focus();
    setTimeout(() => document.addEventListener("mousedown", this.outside), 0);
  }

  private outside = (event: MouseEvent) => {
    if (this.menu && !this.dom.contains(event.target as Node) && !this.menu.contains(event.target as Node)) {
      this.closeMenu(false);
    }
  };

  private closeMenu(refocus = true) {
    if (!this.menu) return;
    this.menu.remove();
    this.menu = null;
    this.dom.classList.remove("cm-lp-menu-open");
    this.menuButton.setAttribute("aria-expanded", "false");
    document.removeEventListener("mousedown", this.outside);
    this.markActive();
    if (refocus) this.menuButton.focus();
  }
}

/** ArrowDown / ArrowUp next to a table moves into its grid. */
const intoGrid: KeyBinding[] = [
  {
    key: "ArrowDown",
    run: (view) => {
      const l = view.state.doc.lineAt(view.state.selection.main.head);
      if (l.number >= view.state.doc.lines) return false;
      const grid = gridAt(view, view.state.doc.line(l.number + 1).from);
      if (!grid) return false;
      grid.focusCell(0, 0);
      return true;
    },
  },
  {
    key: "ArrowUp",
    run: (view) => {
      const l = view.state.doc.lineAt(view.state.selection.main.head);
      if (l.number <= 1) return false;
      const grid = gridAt(view, view.state.doc.line(l.number - 1).from);
      if (!grid) return false;
      grid.focusCell(grid.rowCount - 1, 0);
      return true;
    },
  },
];

// ——— The editor ———

export function livePreview({
  placeholder,
  onSubmit,
}: {
  placeholder: string;
  onSubmit: () => void;
}): Extension {
  return [
    cardMarkdown,
    history(),
    EditorView.lineWrapping,
    focusField,
    focusTracker,
    decorationField(true),
    popoverField,
    tooltips({ position: "absolute" }),
    formulaClicks,
    closeBrackets(),
    indentUnit.of("    "),
    EditorState.tabSize.of(4),
    placeholderExt(placeholder),
    EditorView.contentAttributes.of({ spellcheck: "true", "aria-multiline": "true" }),
    keymap.of([
      ...formattingKeymap,
      { key: "Mod-Enter", run: () => (onSubmit(), true) },
      { key: "Tab", run: indentMore },
      { key: "Shift-Tab", run: indentLess },
      ...intoGrid,
      ...closeBracketsKeymap,
      ...historyKeymap,
      ...defaultKeymap,
    ]),
  ];
}
