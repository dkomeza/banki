import { describe, expect, test } from "vitest";
import {
  formatTable,
  parseTable,
  rowCells,
  smallestChange,
  storedCell,
  withAlign,
  withCell,
  withColumnAt,
  withColumnMoved,
  withoutColumn,
  withoutRow,
  withRowAt,
  withRowMoved,
} from "./table-model";

const lines = (...rows: string[]) => rows.join("\n");

describe("rowCells", () => {
  test("splits a row on its pipes, trimming each cell", () => {
    expect(rowCells("| a |  b c |d|")).toEqual(["a", "b c", "d"]);
    expect(rowCells("a | b")).toEqual(["a", "b"]);
  });

  test("keeps an escaped pipe in its cell, as typed", () => {
    expect(rowCells(String.raw`| a \| b | c |`)).toEqual([String.raw`a \| b`, "c"]);
    expect(rowCells(String.raw`| ends in \|`)).toEqual([String.raw`ends in \|`]);
  });
});

describe("parseTable", () => {
  test("reads the header, each column's alignment and the body rows", () => {
    const model = parseTable(
      lines("| A | B | C | D |", "| --- | :-- | :-: | --: |", "| 1 | 2 | 3 | 4 |"),
    );

    expect(model.aligns).toEqual([null, "left", "center", "right"]);
    expect(model.rows).toEqual([
      ["A", "B", "C", "D"],
      ["1", "2", "3", "4"],
    ]);
  });

  test("fits each body row to the header, as GFM shows it", () => {
    const model = parseTable(lines("| A | B |", "| - | - |", "| 1 |", "| 1 | 2 | 3 |"));

    expect(model.rows).toEqual([
      ["A", "B"],
      ["1", ""],
      ["1", "2"],
    ]);
  });
});

describe("formatTable", () => {
  test("pads each column to its widest cell", () => {
    const model = parseTable(lines("|Function|Derivative|", "|-|-|", "|$x^n$|$n x^{n-1}$|"));

    expect(formatTable(model)).toBe(
      lines(
        "| Function | Derivative  |",
        "| -------- | ----------- |",
        "| $x^n$    | $n x^{n-1}$ |",
      ),
    );
  });

  test("keeps each column's alignment colons, padding on the side it calls for", () => {
    const model = parseTable(lines("| L | C | R |", "|:-|:-:|-:|", "| left | mid | right |"));

    expect(formatTable(model)).toBe(
      lines("| L    |  C  |     R |", "| :--- | :-: | ----: |", "| left | mid | right |"),
    );
  });

  test("counts characters, not UTF-16 units, so a column with emoji or accents lines up by character", () => {
    const model = parseTable(lines("| a | b |", "|-|-|", "| żółw 🐢 | x |"));

    expect(formatTable(model)).toBe(
      lines("| a      | b   |", "| ------ | --- |", "| żółw 🐢 | x   |"),
    );
  });

  test("writes a table it read back the same once it is padded", () => {
    const padded = lines("| A   |  B  |", "| --- | :-: |", "| 1   |  2  |");

    expect(formatTable(parseTable(padded))).toBe(padded);
  });

  test("keeps an escaped pipe in its cell", () => {
    const model = withCell(parseTable(lines("| A |", "| - |", "| x |")), 1, 0, "a | b");

    expect(formatTable(model)).toBe(lines("| A      |", "| ------ |", String.raw`| a \| b |`));
    expect(parseTable(formatTable(model)).rows[1]).toEqual([String.raw`a \| b`]);
  });
});

describe("storedCell", () => {
  test("escapes a pipe typed in a cell", () => {
    expect(storedCell("a|b")).toBe(String.raw`a\|b`);
  });

  test("leaves a pipe that is escaped already alone", () => {
    expect(storedCell(String.raw`a\|b`)).toBe(String.raw`a\|b`);
  });

  test("escapes a pipe after an escaped backslash", () => {
    expect(storedCell(String.raw`a\\|b`)).toBe(String.raw`a\\\|b`);
  });

  test("keeps a cell on one line", () => {
    expect(storedCell("a\nb")).toBe("a b");
  });
});

describe("the grid's edits", () => {
  const table = parseTable(lines("| A | B |", "| :- | -: |", "| 1 | 2 |", "| 3 | 4 |"));

  test("add a body row, never above the header", () => {
    expect(withRowAt(table, 2).rows).toEqual([
      ["A", "B"],
      ["1", "2"],
      ["", ""],
      ["3", "4"],
    ]);
    expect(withRowAt(table, 0).rows[1]).toEqual(["", ""]);
  });

  test("delete a body row, never the header", () => {
    expect(withoutRow(table, 1).rows).toEqual([
      ["A", "B"],
      ["3", "4"],
    ]);
    expect(withoutRow(table, 0)).toBe(table);
  });

  test("move a body row, never into the header", () => {
    expect(withRowMoved(table, 1, 1).rows).toEqual([
      ["A", "B"],
      ["3", "4"],
      ["1", "2"],
    ]);
    expect(withRowMoved(table, 1, -1)).toBe(table);
  });

  test("add a column, unaligned, keeping the others' alignment", () => {
    const wider = withColumnAt(table, 1);

    expect(wider.rows[0]).toEqual(["A", "", "B"]);
    expect(wider.aligns).toEqual(["left", null, "right"]);
  });

  test("delete a column, never the last one", () => {
    const narrower = withoutColumn(table, 0);

    expect(narrower.rows).toEqual([["B"], ["2"], ["4"]]);
    expect(narrower.aligns).toEqual(["right"]);
    expect(withoutColumn(narrower, 0)).toBe(narrower);
  });

  test("move a column with its alignment", () => {
    const moved = withColumnMoved(table, 0, 1);

    expect(moved.rows[1]).toEqual(["2", "1"]);
    expect(moved.aligns).toEqual(["right", "left"]);
    expect(withColumnMoved(table, 1, 1)).toBe(table);
  });

  test("align a column", () => {
    expect(withAlign(table, 1, "center").aligns).toEqual(["left", "center"]);
  });
});

describe("smallestChange", () => {
  test("replaces only what differs", () => {
    expect(smallestChange("| a | b |", "| a | bc |", 10)).toEqual({
      from: 17,
      to: 17,
      insert: "c",
    });
  });

  test("is nothing when nothing differs", () => {
    expect(smallestChange("same", "same")).toBeNull();
  });
});
