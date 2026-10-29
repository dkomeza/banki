// A GFM table as the grid edits it: its rows of cells and each column's
// alignment, read from the table's source, and written back out whole with its
// columns padded to the widest cell and its alignment colons kept (ADR-0022).

/** A column's alignment: its delimiter's colons, or none. */
export type Align = "left" | "center" | "right" | null;

/** A table: the header row first, then the body rows, each as wide as `aligns`. */
export type TableModel = {
  readonly rows: readonly (readonly string[])[];
  readonly aligns: readonly Align[];
};

/**
 * The cells of one row of a table's source, split on each `|` that isn't
 * escaped, each trimmed. A `\|` stays as typed, so the cell's Markdown is
 * kept.
 */
export function rowCells(line: string): string[] {
  let text = line.trim();
  if (text.startsWith("|")) text = text.slice(1);
  if (text.endsWith("|") && !isEscaped(text, text.length - 1)) text = text.slice(0, -1);
  const cells: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\\") i++;
    else if (text[i] === "|") {
      cells.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  cells.push(text.slice(start).trim());
  return cells;
}

/** Whether the character at `at` in `text` follows an odd run of backslashes. */
function isEscaped(text: string, at: number): boolean {
  let slashes = 0;
  for (let i = at - 1; i >= 0 && text[i] === "\\"; i--) slashes++;
  return slashes % 2 === 1;
}

function alignOf(delimiter: string): Align {
  const left = delimiter.startsWith(":");
  const right = delimiter.endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  if (left) return "left";
  return null;
}

/**
 * Reads a table's source: its header, its delimiter row and its body rows,
 * one to a line. Each body row is fitted to the header's width, as GFM shows
 * it: a short row gets empty cells, and cells past the header's are dropped.
 */
export function parseTable(source: string): TableModel {
  const [header = "", delimiter = "", ...body] = source
    .split("\n")
    .filter((line) => line.trim() !== "");
  const aligns = rowCells(delimiter).map(alignOf);
  const fit = (cells: readonly string[]) => aligns.map((_, i) => cells[i] ?? "");
  return { rows: [fit(rowCells(header)), ...body.map((line) => fit(rowCells(line)))], aligns };
}

/**
 * A cell's text as stored: one line, its line breaks as spaces, with each `|`
 * typed in it escaped as `\|`, so it stays in its cell.
 */
export function storedCell(text: string): string {
  let out = "";
  const line = text.replaceAll(/\r?\n/g, " ");
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === "\\" && i + 1 < line.length) {
      out += char + line[i + 1];
      i++;
    } else out += char === "|" ? "\\|" : char;
  }
  return out;
}

/** How many characters `text` is, counting code points rather than UTF-16 units. */
const width = (text: string) => Array.from(text).length;

/** The narrowest a column is written: room for its delimiter's dashes and colons. */
const MIN_WIDTH = 3;

/**
 * Writes a table out: every row on its own line between pipes, with each
 * column padded to its widest cell (counting characters) on the side its
 * alignment calls for, and the delimiter row's colons kept.
 */
export function formatTable({ rows, aligns }: TableModel): string {
  const widths = aligns.map((_, c) =>
    Math.max(MIN_WIDTH, ...rows.map((row) => width(row[c] ?? ""))),
  );
  const pad = (text: string, c: number) => {
    const extra = (widths[c] ?? MIN_WIDTH) - width(text);
    if (aligns[c] === "right") return " ".repeat(extra) + text;
    if (aligns[c] === "center") {
      const before = Math.floor(extra / 2);
      return " ".repeat(before) + text + " ".repeat(extra - before);
    }
    return text + " ".repeat(extra);
  };
  const line = (cells: readonly string[]) =>
    `| ${aligns.map((_, c) => pad(cells[c] ?? "", c)).join(" | ")} |`;
  const delimiter = `| ${aligns
    .map((align, c) => {
      const dashes = widths[c] ?? MIN_WIDTH;
      if (align === "center") return `:${"-".repeat(dashes - 2)}:`;
      if (align === "right") return `${"-".repeat(dashes - 1)}:`;
      if (align === "left") return `:${"-".repeat(dashes - 1)}`;
      return "-".repeat(dashes);
    })
    .join(" | ")} |`;
  const [header = [], ...body] = rows;
  return [line(header), delimiter, ...body.map(line)].join("\n");
}

/** A change to a document: replace `from`…`to` with `insert`. */
export type TextChange = { from: number; to: number; insert: string };

/**
 * The smallest change that turns `before` into `after`, both starting at
 * `offset` in the document: only what differs between their common start
 * and end is replaced, so the cursor and the undo history map through the
 * rest.
 */
export function smallestChange(before: string, after: string, offset = 0): TextChange | null {
  if (before === after) return null;
  let start = 0;
  const shorter = Math.min(before.length, after.length);
  while (start < shorter && before.charCodeAt(start) === after.charCodeAt(start)) start++;
  let end = 0;
  while (
    end < shorter - start &&
    before.charCodeAt(before.length - 1 - end) === after.charCodeAt(after.length - 1 - end)
  ) {
    end++;
  }
  return {
    from: offset + start,
    to: offset + before.length - end,
    insert: after.slice(start, after.length - end),
  };
}

// ——— The grid's edits: each returns the table after it ———

const copy = (model: TableModel) => model.rows.map((row) => [...row]);
const emptyRow = (model: TableModel) => model.aligns.map(() => "");

/** The table with cell `r`, `c` holding `text`, stored as {@link storedCell} stores it. */
export function withCell(model: TableModel, r: number, c: number, text: string): TableModel {
  const rows = copy(model);
  const row = rows[r];
  if (row === undefined || c < 0 || c >= row.length) return model;
  row[c] = storedCell(text);
  return { rows, aligns: model.aligns };
}

/** The table with an empty body row at `at` (1 is the first body row). */
export function withRowAt(model: TableModel, at: number): TableModel {
  const rows = copy(model);
  rows.splice(Math.max(1, Math.min(at, rows.length)), 0, emptyRow(model));
  return { rows, aligns: model.aligns };
}

/** The table without body row `r`; the header stays. */
export function withoutRow(model: TableModel, r: number): TableModel {
  if (r < 1 || r >= model.rows.length) return model;
  const rows = copy(model);
  rows.splice(r, 1);
  return { rows, aligns: model.aligns };
}

/** The table with body row `r` swapped with the one `by` away, if both are body rows. */
export function withRowMoved(model: TableModel, r: number, by: -1 | 1): TableModel {
  const to = r + by;
  if (r < 1 || to < 1 || r >= model.rows.length || to >= model.rows.length) return model;
  const rows = copy(model);
  [rows[r], rows[to]] = [rows[to] ?? [], rows[r] ?? []];
  return { rows, aligns: model.aligns };
}

/** The table with an empty, unaligned column at `at`. */
export function withColumnAt(model: TableModel, at: number): TableModel {
  const index = Math.max(0, Math.min(at, model.aligns.length));
  const rows = copy(model);
  for (const row of rows) row.splice(index, 0, "");
  const aligns = [...model.aligns];
  aligns.splice(index, 0, null);
  return { rows, aligns };
}

/** The table without column `c`, unless it is the only one. */
export function withoutColumn(model: TableModel, c: number): TableModel {
  if (model.aligns.length <= 1 || c < 0 || c >= model.aligns.length) return model;
  const rows = copy(model);
  for (const row of rows) row.splice(c, 1);
  return { rows, aligns: model.aligns.filter((_, i) => i !== c) };
}

/** The table with column `c` swapped with the one `by` away, alignment and all. */
export function withColumnMoved(model: TableModel, c: number, by: -1 | 1): TableModel {
  const to = c + by;
  const count = model.aligns.length;
  if (c < 0 || to < 0 || c >= count || to >= count) return model;
  const rows = copy(model);
  for (const row of rows) [row[c], row[to]] = [row[to] ?? "", row[c] ?? ""];
  const aligns = [...model.aligns];
  [aligns[c], aligns[to]] = [aligns[to] ?? null, aligns[c] ?? null];
  return { rows, aligns };
}

/** The table with column `c` aligned `align`. */
export function withAlign(model: TableModel, c: number, align: Align): TableModel {
  if (c < 0 || c >= model.aligns.length) return model;
  const aligns = [...model.aligns];
  aligns[c] = align;
  return { rows: model.rows, aligns };
}
