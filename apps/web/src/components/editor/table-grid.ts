import type { AutoClose, CardNode, Macro } from "@banki/shared";
import { defaultKeymap, isolateHistory, redo, undo } from "@codemirror/commands";
import { Compartment, EditorSelection, EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap, WidgetType } from "@codemirror/view";
import { autoCloseExtension } from "./auto-close";
import { autoCloseChoice, formattingKeymap, previewCore, submitAction } from "./core";
import { formulaMacros } from "./formula-macros";
import { livePreviewDecorations } from "./decorations";
import { treeOf } from "./language";
import {
  type Align,
  formatTable,
  parseTable,
  smallestChange,
  storedCell,
  type TableModel,
  withAlign,
  withCell,
  withColumnAt,
  withColumnMoved,
  withoutColumn,
  withoutRow,
  withRowAt,
  withRowMoved,
} from "./table-model";
import { type MenuGroup, renderMenu } from "./table-menu";
import { fileUploads, imageUploads } from "./uploads";
import { snapToLines, unsnap } from "./widgets";

// A complete GFM table shows as an editable grid, whether or not the cursor
// is in it. Each cell is a one-line live-preview editor. Every change the
// grid makes goes into the side's own document as one change to the whole
// table, written back padded (ADR-0022), so the side's one undo history
// covers it; and every change to the side's document reaches the grid.

const grids = new WeakMap<HTMLElement, TableGrid>();

/** A cell's preview: one line, so no blocks. */
const cellDecorations = livePreviewDecorations({ blocks: false });

/** The grid of the table on the line at `pos`, if it is drawn. */
export function gridAt(view: EditorView, pos: number): TableGrid | undefined {
  for (const el of view.contentDOM.querySelectorAll<HTMLElement>(".cm-lp-table")) {
    const grid = grids.get(el);
    const range = grid?.locate();
    if (range !== null && range !== undefined && range.from <= pos && pos <= range.to) return grid;
  }
  return undefined;
}

/** Once the grid of the table at `pos` is drawn, puts the cursor in its first header cell. */
export function focusFirstCell(view: EditorView, pos: number): void {
  requestAnimationFrame(() => gridAt(view, pos)?.focusCell(0, 0));
}

/** The grid a table shows as: equal while its source and the side's settings are. */
export class TableWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly readOnly: boolean,
    readonly autoClose: AutoClose,
    readonly macros: readonly Macro[],
  ) {
    super();
  }

  static of(source: string, state: EditorState): TableWidget {
    return new TableWidget(
      source,
      state.readOnly,
      state.facet(autoCloseChoice),
      state.facet(formulaMacros),
    );
  }

  override eq(other: TableWidget) {
    return (
      other.source === this.source &&
      other.readOnly === this.readOnly &&
      other.autoClose === this.autoClose &&
      other.macros === this.macros
    );
  }

  toDOM(view: EditorView) {
    return new TableGrid(view, this).dom;
  }

  override updateDOM(dom: HTMLElement) {
    const grid = grids.get(dom);
    if (grid === undefined) return false;
    grid.update(this);
    return true;
  }

  override destroy(dom: HTMLElement) {
    grids.get(dom)?.destroy();
  }

  // The grid's own editors and menu take their events.
  override ignoreEvent() {
    return true;
  }
}

type Cell = { r: number; c: number };

class TableGrid {
  readonly dom: HTMLElement;
  private readonly table: HTMLTableElement;
  private readonly menuButton: HTMLButtonElement;
  private model: TableModel;
  private cells: EditorView[][] = [];
  private current: Cell = { r: 0, c: 0 };
  private menu: HTMLElement | null = null;
  /** The cell whose typing is being written to the side, which already shows it. */
  private writing: Cell | null = null;
  private readonly readOnly = new Compartment();
  private readonly autoClose = new Compartment();
  private readonly macros = new Compartment();
  private settings: { readOnly: boolean; autoClose: AutoClose; macros: readonly Macro[] };

  constructor(
    private readonly outer: EditorView,
    widget: TableWidget,
  ) {
    this.model = parseTable(widget.source);
    this.settings = {
      readOnly: widget.readOnly,
      autoClose: widget.autoClose,
      macros: widget.macros,
    };
    this.dom = document.createElement("div");
    this.dom.className = "cm-lp-table";
    const card = document.createElement("div");
    card.className = "cm-lp-table-card";
    const scroller = document.createElement("div");
    scroller.className = "cm-lp-table-scroll";
    this.table = document.createElement("table");
    this.table.className = "cm-lp-grid";
    scroller.append(this.table);
    this.menuButton = document.createElement("button");
    this.menuButton.type = "button";
    this.menuButton.className = "cm-lp-table-menu-button";
    this.menuButton.setAttribute("aria-label", "Table options");
    this.menuButton.setAttribute("aria-haspopup", "menu");
    this.menuButton.setAttribute("aria-expanded", "false");
    this.menuButton.innerHTML =
      '<svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>';
    this.menuButton.addEventListener("click", () => {
      if (this.menu === null) this.openMenu();
      else this.closeMenu(true);
    });
    card.append(this.menuButton, scroller);
    this.dom.append(card);
    grids.set(this.dom, this);
    this.render();
    snapToLines(this.dom, outer);
  }

  /** The table's lines in the side's document, while the grid is drawn. */
  locate(): { from: number; to: number } | null {
    if (!this.dom.isConnected) return null;
    let pos: number;
    try {
      pos = this.outer.posAtDOM(this.dom);
    } catch {
      return null;
    }
    const { doc } = this.outer.state;
    for (
      let node: CardNode | null = treeOf(this.outer.state).resolveInner(pos, 1);
      node;
      node = node.parent
    ) {
      if (node.name === "Table")
        return { from: doc.lineAt(node.from).from, to: doc.lineAt(node.to).to };
    }
    return null;
  }

  /** Brings the grid in line with the table's source and the side's settings. */
  update(widget: TableWidget): void {
    if (
      widget.readOnly !== this.settings.readOnly ||
      widget.autoClose !== this.settings.autoClose ||
      widget.macros !== this.settings.macros
    ) {
      this.settings = {
        readOnly: widget.readOnly,
        autoClose: widget.autoClose,
        macros: widget.macros,
      };
      for (const view of this.cells.flat()) {
        view.dispatch({
          effects: [
            this.readOnly.reconfigure(EditorState.readOnly.of(widget.readOnly)),
            this.autoClose.reconfigure(autoCloseExtension(widget.autoClose)),
            this.macros.reconfigure(formulaMacros.of(widget.macros)),
          ],
        });
      }
    }
    const next = parseTable(widget.source);
    const sameShape =
      next.rows.length === this.model.rows.length &&
      next.aligns.length === this.model.aligns.length &&
      next.aligns.every((align, c) => align === this.model.aligns[c]);
    this.model = next;
    if (!sameShape) {
      const focused = this.focusedCell();
      this.render();
      if (focused !== null)
        this.focusCell(
          Math.min(focused.r, next.rows.length - 1),
          Math.min(focused.c, next.aligns.length - 1),
        );
      return;
    }
    next.rows.forEach((row, r) =>
      row.forEach((text, c) => {
        if (this.writing?.r === r && this.writing.c === c) return;
        const view = this.cells[r]?.[c];
        const change = view === undefined ? null : smallestChange(view.state.doc.toString(), text);
        if (view !== undefined && change !== null) view.dispatch({ changes: change });
      }),
    );
  }

  destroy(): void {
    this.closeMenu(false);
    for (const view of this.cells.flat()) view.destroy();
    unsnap(this.dom);
  }

  private focusedCell(): Cell | null {
    for (const [r, row] of this.cells.entries()) {
      for (const [c, view] of row.entries()) if (view.hasFocus) return { r, c };
    }
    return null;
  }

  private render(): void {
    for (const view of this.cells.flat()) view.destroy();
    this.cells = [];
    const head = document.createElement("thead");
    const body = document.createElement("tbody");
    this.model.rows.forEach((row, r) => {
      const tr = document.createElement("tr");
      this.cells.push(
        row.map((text, c) => {
          const cell = document.createElement(r === 0 ? "th" : "td");
          cell.className = "cm-lp-cell";
          if (r === 0) cell.scope = "col";
          const align = this.model.aligns[c];
          if (align !== null && align !== undefined) cell.style.textAlign = align;
          tr.append(cell);
          return new EditorView({
            parent: cell,
            state: EditorState.create({ doc: text, extensions: this.cellExtensions({ r, c }) }),
          });
        }),
      );
      (r === 0 ? head : body).append(tr);
    });
    this.table.replaceChildren(head, body);
  }

  private cellExtensions(at: Cell): Extension {
    const { r, c } = at;
    const header = this.model.rows[0]?.[c];
    return [
      previewCore(cellDecorations),
      // The side's uploads, an Image going in inline at the cursor.
      fileUploads(this.outer.state.facet(imageUploads), true),
      this.readOnly.of(EditorState.readOnly.of(this.settings.readOnly)),
      this.autoClose.of(autoCloseExtension(this.settings.autoClose)),
      this.macros.of(formulaMacros.of(this.settings.macros)),
      EditorView.contentAttributes.of({
        "aria-label":
          r === 0
            ? `Header, column ${c + 1}`
            : `Row ${r}, ${header === undefined || header === "" ? `column ${c + 1}` : header}`,
        "aria-multiline": "false",
      }),
      // A cell is one line, and a `|` typed in it is stored escaped.
      EditorState.transactionFilter.of((tr) => {
        if (!tr.docChanged) return tr;
        const text = tr.newDoc.toString();
        const change = smallestChange(text, storedCell(text));
        return change === null ? tr : [tr, { changes: change, sequential: true }];
      }),
      keymap.of([
        { key: "Tab", run: () => this.step(1) },
        { key: "Shift-Tab", run: () => this.step(-1) },
        { key: "Enter", run: () => this.down() },
        { key: "ArrowDown", run: () => this.vertical(1) },
        { key: "ArrowUp", run: () => this.vertical(-1) },
        { key: "Escape", run: () => this.leave() },
        { key: "Mod-Enter", run: () => (this.outer.state.facet(submitAction)(), true) },
        // One undo history, the side's, table edits and all.
        { key: "Mod-z", run: () => undo(this.outer) },
        { key: "Mod-y", run: () => redo(this.outer) },
        { key: "Mod-Shift-z", run: () => redo(this.outer) },
        ...formattingKeymap,
        ...defaultKeymap,
      ]),
      EditorView.updateListener.of((update) => {
        if (update.focusChanged && update.view.hasFocus) this.current = at;
        if (update.focusChanged) this.markActive();
        // What the User changes in the cell, not the grid bringing it in line.
        if (
          update.docChanged &&
          update.transactions.some((tr) => tr.isUserEvent("input") || tr.isUserEvent("delete"))
        ) {
          // An Image put in stays one undo step in the side.
          const isolated = update.transactions.some(
            (tr) => tr.annotation(isolateHistory) !== undefined,
          );
          this.cellChanged(at, update.state.doc.toString(), isolated);
        }
      }),
    ];
  }

  private markActive(): void {
    this.cells.forEach((row, r) =>
      row.forEach((view, c) => {
        const active =
          view.hasFocus || (this.menu !== null && r === this.current.r && c === this.current.c);
        view.dom.parentElement?.classList.toggle("cm-lp-cell-active", active);
      }),
    );
  }

  /**
   * Writes `model` over the table in the side's document, as an undo step of
   * its own when `isolated`.
   */
  private write(model: TableModel, isolated = false): void {
    const range = this.locate();
    if (range === null) return;
    // The grid takes the model from the source it is drawn from (update), so
    // a change of shape redraws it.
    const change = smallestChange(
      this.outer.state.sliceDoc(range.from, range.to),
      formatTable(model),
      range.from,
    );
    if (change !== null) {
      this.outer.dispatch({
        changes: change,
        userEvent: "input.table",
        annotations: isolated ? isolateHistory.of("full") : [],
      });
    }
  }

  private cellChanged(at: Cell, text: string, isolated: boolean): void {
    this.writing = at;
    try {
      this.write(withCell(this.model, at.r, at.c, text), isolated);
    } finally {
      this.writing = null;
    }
  }

  /** Puts the cursor in cell `r`, `c`, at `offset` or its end. */
  focusCell(r: number, c: number, offset?: number): void {
    const view = this.cells[r]?.[c];
    if (view === undefined) return;
    this.current = { r, c };
    view.focus();
    view.dom.parentElement?.scrollIntoView({ block: "nearest", inline: "nearest" });
    const length = view.state.doc.length;
    view.dispatch({ selection: EditorSelection.cursor(Math.min(offset ?? length, length)) });
  }

  /** The cursor in the first cell of the last row, a new first row if there is none. */
  continueTyping(): void {
    if (this.model.rows.length > 1) this.focusCell(this.lastRow, 0);
    else this.restructure(withRowAt(this.model, 1), { r: 1, c: 0 });
  }

  /** Writes `model`, then puts the cursor in `cell` once the grid is redrawn. */
  private restructure(model: TableModel, cell: Cell): void {
    this.current = cell;
    this.write(model);
    requestAnimationFrame(() => this.focusCell(cell.r, cell.c));
  }

  private get width() {
    return this.model.aligns.length;
  }

  /** The index of the last row. */
  get lastRow() {
    return this.model.rows.length - 1;
  }

  /** Tab and Shift+Tab: the next or previous cell; Tab in the last one adds a row. */
  private step(by: 1 | -1): boolean {
    const index = this.current.r * this.width + this.current.c + by;
    // Shift+Tab in the first cell moves on, out of the grid, as Tab would.
    if (index < 0) return false;
    if (index >= this.model.rows.length * this.width) {
      const r = this.model.rows.length;
      this.restructure(withRowAt(this.model, r), { r, c: 0 });
      return true;
    }
    this.focusCell(Math.floor(index / this.width), index % this.width);
    return true;
  }

  /** Enter: the cell below, adding a row from the last one. */
  private down(): boolean {
    const { r, c } = this.current;
    if (r + 1 < this.model.rows.length) this.focusCell(r + 1, c);
    else this.restructure(withRowAt(this.model, r + 1), { r: r + 1, c });
    return true;
  }

  /** The arrow keys: the cell above or below, or out of the grid at its edge. */
  private vertical(by: 1 | -1): boolean {
    const { r, c } = this.current;
    if (r + by >= 0 && r + by < this.model.rows.length) {
      this.focusCell(r + by, c);
      return true;
    }
    if (by === 1) return this.leave();
    const range = this.locate();
    if (range === null) return false;
    const { doc } = this.outer.state;
    const above = doc.lineAt(range.from).number - 1;
    this.outer.focus();
    if (above >= 1) this.outer.dispatch({ selection: { anchor: doc.line(above).to } });
    // Nothing above the table: a line for the cursor.
    else this.outer.dispatch({ changes: { from: 0, insert: "\n" }, selection: { anchor: 0 } });
    return true;
  }

  /**
   * Escape: the cursor on the line after the table. With none, it makes one,
   * after a blank line: text right under a table would be one of its rows.
   */
  private leave(): boolean {
    const range = this.locate();
    if (range === null) return false;
    const { doc } = this.outer.state;
    const line = doc.lineAt(range.to).number;
    this.outer.focus();
    if (line < doc.lines) this.outer.dispatch({ selection: { anchor: doc.line(line + 1).from } });
    else {
      this.outer.dispatch({
        changes: { from: range.to, insert: "\n\n" },
        selection: { anchor: range.to + 2 },
      });
    }
    return true;
  }

  // ——— The ⋯ menu ———

  private groups(): MenuGroup[] {
    const { r, c } = this.current;
    const model = this.model;
    const rows = model.rows.length;
    const align = (to: Align) => () => this.restructure(withAlign(model, c, to), { r, c });
    return [
      {
        name: "Row",
        items: [
          {
            label: "Add row above",
            icon: "rowAbove",
            disabled: r === 0,
            run: () => this.restructure(withRowAt(model, r), { r, c }),
          },
          {
            label: "Add row below",
            icon: "rowBelow",
            run: () => this.restructure(withRowAt(model, r + 1), { r: Math.max(1, r + 1), c }),
          },
          {
            label: "Move row up",
            icon: "rowUp",
            disabled: r <= 1,
            run: () => this.restructure(withRowMoved(model, r, -1), { r: r - 1, c }),
          },
          {
            label: "Move row down",
            icon: "rowDown",
            disabled: r === 0 || r >= rows - 1,
            run: () => this.restructure(withRowMoved(model, r, 1), { r: r + 1, c }),
          },
          {
            label: "Delete row",
            icon: "delete",
            danger: true,
            disabled: r === 0,
            run: () => this.restructure(withoutRow(model, r), { r: Math.min(r, rows - 2), c }),
          },
        ],
      },
      {
        name: "Column",
        items: [
          {
            label: "Add column left",
            icon: "columnLeft",
            run: () => this.restructure(withColumnAt(model, c), { r, c }),
          },
          {
            label: "Add column right",
            icon: "columnRight",
            run: () => this.restructure(withColumnAt(model, c + 1), { r, c: c + 1 }),
          },
          {
            label: "Move column left",
            icon: "columnBack",
            disabled: c === 0,
            run: () => this.restructure(withColumnMoved(model, c, -1), { r, c: c - 1 }),
          },
          {
            label: "Move column right",
            icon: "columnOn",
            disabled: c >= this.width - 1,
            run: () => this.restructure(withColumnMoved(model, c, 1), { r, c: c + 1 }),
          },
          {
            label: "Delete column",
            icon: "delete",
            danger: true,
            disabled: this.width <= 1,
            run: () => this.restructure(withoutColumn(model, c), { r, c: Math.max(0, c - 1) }),
          },
        ],
      },
      {
        name: "Align",
        items: [
          { label: "Align column left", icon: "alignLeft", run: align("left") },
          { label: "Align column center", icon: "alignCenter", run: align("center") },
          { label: "Align column right", icon: "alignRight", run: align("right") },
        ],
      },
      {
        name: "Table",
        items: [
          {
            label: "Delete table",
            icon: "deleteTable",
            danger: true,
            run: () => this.deleteTable(),
          },
        ],
      },
    ];
  }

  private deleteTable(): void {
    const range = this.locate();
    if (range === null) return;
    const { doc } = this.outer.state;
    this.outer.focus();
    this.outer.dispatch({
      changes: { from: range.from, to: Math.min(range.to + 1, doc.length) },
      selection: { anchor: range.from },
      userEvent: "delete.table",
    });
  }

  private openMenu(): void {
    if (this.outer.state.readOnly) return;
    const { menu, items } = renderMenu(this.groups(), {
      run: (item) => {
        this.closeMenu(false);
        item.run();
      },
      close: (refocus) => this.closeMenu(refocus),
    });
    this.menu = menu;
    // On the page, over everything: the side's editor would clip it.
    document.body.append(menu);
    const button = this.menuButton.getBoundingClientRect();
    const onRight = button.left + button.width / 2 > window.innerWidth / 2;
    menu.style.top = `${button.bottom + window.scrollY + 6}px`;
    menu.style.left = `${Math.max(8, (onRight ? button.right - menu.offsetWidth : button.left) + window.scrollX)}px`;
    this.menuButton.setAttribute("aria-expanded", "true");
    this.menuButton.setAttribute("aria-controls", menu.id);
    this.dom.classList.add("cm-lp-table-menu-open");
    this.markActive();
    items.find((item) => item.getAttribute("aria-disabled") !== "true")?.focus();
    document.addEventListener("pointerdown", this.onPointerDown, true);
  }

  private readonly onPointerDown = (event: PointerEvent) => {
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (this.menu?.contains(target) === true || this.menuButton.contains(target)) return;
    this.closeMenu(false);
  };

  private closeMenu(refocus: boolean): void {
    if (this.menu === null) return;
    this.menu.remove();
    this.menu = null;
    this.menuButton.setAttribute("aria-expanded", "false");
    this.menuButton.removeAttribute("aria-controls");
    this.dom.classList.remove("cm-lp-table-menu-open");
    document.removeEventListener("pointerdown", this.onPointerDown, true);
    this.markActive();
    if (refocus) this.menuButton.focus();
  }
}

/**
 * Puts the cursor in the first cell of the last row of the table at `pos`,
 * just typed: a table with only its header gets its first row for it.
 */
export function continueInGrid(view: EditorView, pos: number): boolean {
  const grid = gridAt(view, pos);
  if (grid === undefined) return false;
  grid.continueTyping();
  return true;
}

/** Puts the cursor in the grid of the table at `pos`: its first row, or its last. */
export function enterGrid(view: EditorView, pos: number, lastRow: boolean): boolean {
  const grid = gridAt(view, pos);
  if (grid === undefined) return false;
  grid.focusCell(lastRow ? grid.lastRow : 0, 0);
  return true;
}
