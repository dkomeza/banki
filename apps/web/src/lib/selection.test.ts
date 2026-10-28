import { describe, expect, test } from "vitest";
import { allShownSelected, clicked, selectAllShown, selectedOf } from "./selection";

const SHOWN = ["a", "b", "c", "d", "e"];
const set = (...ids: string[]) => new Set(ids);

describe("clicked", () => {
  test("toggles the Card clicked", () => {
    expect(clicked(set(), "b", SHOWN, { range: false, anchor: undefined })).toEqual(set("b"));
    expect(clicked(set("b", "c"), "b", SHOWN, { range: false, anchor: "c" })).toEqual(set("c"));
  });

  test("with Shift, selects every shown Card between the last one clicked and this one", () => {
    expect(clicked(set("b"), "d", SHOWN, { range: true, anchor: "b" })).toEqual(set("b", "c", "d"));
  });

  test("selects the range upwards too, keeping what was selected before", () => {
    expect(clicked(set("a", "e"), "b", SHOWN, { range: true, anchor: "d" })).toEqual(
      set("a", "b", "c", "d", "e"),
    );
  });

  test("selects only shown Cards in the range, in timeline order", () => {
    // "x" is selected but hidden by a filter; the range doesn't reach it.
    expect(clicked(set("x"), "c", ["a", "c", "e"], { range: true, anchor: "a" })).toEqual(
      set("x", "a", "c"),
    );
  });

  test("toggles when Shift has no last click, or the last click isn't shown", () => {
    expect(clicked(set(), "c", SHOWN, { range: true, anchor: undefined })).toEqual(set("c"));
    expect(clicked(set("z"), "c", SHOWN, { range: true, anchor: "z" })).toEqual(set("z", "c"));
  });
});

describe("selectAllShown", () => {
  test("selects only the shown Cards, keeping hidden selected ones", () => {
    expect(selectAllShown(set("x"), ["a", "b"])).toEqual(set("x", "a", "b"));
  });

  test("unselects the shown Cards when they are all selected, keeping hidden ones", () => {
    expect(selectAllShown(set("x", "a", "b"), ["a", "b"])).toEqual(set("x"));
  });

  test("does nothing with no Card shown", () => {
    expect(selectAllShown(set("x"), [])).toEqual(set("x"));
  });
});

describe("allShownSelected", () => {
  test("is true only when there are shown Cards and all are selected", () => {
    expect(allShownSelected(set("a", "b"), ["a", "b"])).toBe(true);
    expect(allShownSelected(set("a"), ["a", "b"])).toBe(false);
    expect(allShownSelected(set("a"), [])).toBe(false);
  });
});

describe("selectedOf", () => {
  test("answers the selected Cards still listed, shown or not, in list order", () => {
    const cards = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(selectedOf(set("c", "a", "gone"), cards)).toEqual([{ id: "a" }, { id: "c" }]);
  });
});
