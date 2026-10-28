// A GFM table as rows of cells, read from its source and written back padded
// (ADR-0022). Prototype code: the implement Stage rewrites it with tests.

export type Align = "left" | "center" | "right" | null;

export type TableModel = { rows: string[][]; aligns: Align[] };

/** The cells of one table row, split on `|` that isn't escaped. */
function cellsOf(line: string): string[] {
  let text = line.trim();
  if (text.startsWith("|")) text = text.slice(1);
  if (text.endsWith("|") && !text.endsWith("\\|")) text = text.slice(0, -1);
  const cells: string[] = [];
  let current = "";
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === "\\" && text[i + 1] === "|") {
      current += "\\|";
      i++;
    } else if (char === "|") {
      cells.push(current.trim());
      current = "";
    } else current += char;
  }
  cells.push(current.trim());
  return cells;
}

export function parseTable(source: string): TableModel {
  const lines = source.split("\n").filter((line) => line.trim() !== "");
  const [header = "", delimiter = "", ...body] = lines;
  const aligns: Align[] = cellsOf(delimiter).map((cell) => {
    const left = cell.startsWith(":");
    const right = cell.endsWith(":");
    return left && right ? "center" : right ? "right" : left ? "left" : null;
  });
  const width = aligns.length;
  const fit = (cells: string[]) =>
    Array.from({ length: width }, (_, i) => cells[i] ?? "");
  return { rows: [fit(cellsOf(header)), ...body.map((line) => fit(cellsOf(line)))], aligns };
}

/** A cell's text as stored: a `|` typed in it escaped, no line breaks. */
export const storedCell = (text: string) =>
  text.replace(/\n/g, " ").replace(/(^|[^\\])\|/g, "$1\\|");

export function formatTable({ rows, aligns }: TableModel): string {
  const widths = aligns.map((_, c) =>
    Math.max(3, ...rows.map((row) => [...(row[c] ?? "")].length)),
  );
  const pad = (text: string, c: number) => {
    const extra = widths[c]! - [...text].length;
    if (aligns[c] === "right") return " ".repeat(extra) + text;
    if (aligns[c] === "center") {
      const left = Math.floor(extra / 2);
      return " ".repeat(left) + text + " ".repeat(extra - left);
    }
    return text + " ".repeat(extra);
  };
  const line = (cells: string[]) => `| ${cells.map((cell, c) => pad(cell, c)).join(" | ")} |`;
  const delimiter = `| ${aligns
    .map((align, c) => {
      const w = widths[c]!;
      if (align === "center") return `:${"-".repeat(w - 2)}:`;
      if (align === "right") return `${"-".repeat(w - 1)}:`;
      if (align === "left") return `:${"-".repeat(w - 1)}`;
      return "-".repeat(w);
    })
    .join(" | ")} |`;
  const [header = [], ...body] = rows;
  return [line(header), delimiter, ...body.map(line)].join("\n");
}
