import { describe, expect, test } from "vitest";
import {
  calendarWeeks,
  levelsOf,
  longDay,
  minutesLabel,
  modelName,
  rangeLabel,
  searchFor,
  statisticsSearch,
} from "./statistics";

describe("statisticsSearch", () => {
  test("keeps a range other than the default", () => {
    expect(statisticsSearch({ range: "7" })).toEqual({ range: 7 });
    expect(statisticsSearch({ range: 90 })).toEqual({ range: 90 });
    expect(statisticsSearch({ range: "all" })).toEqual({ range: "all" });
  });

  test("leaves out the default, and falls back to it for a range it doesn't know", () => {
    expect(statisticsSearch({})).toEqual({});
    expect(statisticsSearch({ range: "30" })).toEqual({});
    expect(statisticsSearch({ range: "365" })).toEqual({});
    expect(statisticsSearch({ range: ["7"] })).toEqual({});
  });

  test("puts the default out of the URL, and days as a number", () => {
    expect(searchFor("30")).toEqual({});
    expect(searchFor("7")).toEqual({ range: 7 });
    expect(searchFor("all")).toEqual({ range: "all" });
  });
});

describe("calendarWeeks", () => {
  test("are 53 weeks of 7 days, Monday first, to the current week, days after today blank", () => {
    // Friday 13 November 2026.
    const weeks = calendarWeeks("2026-11-13");
    expect(weeks).toHaveLength(53);
    expect(weeks.every((week) => week.length === 7)).toBe(true);
    expect(weeks[0]?.[0]).toBe("2025-11-10");
    expect(longDay("2025-11-10")).toBe("Mon, 10 Nov 2025");
    expect(weeks.at(-1)).toEqual([
      "2026-11-09",
      "2026-11-10",
      "2026-11-11",
      "2026-11-12",
      "2026-11-13",
      null,
      null,
    ]);
  });

  test("end on a full week on a Sunday", () => {
    expect(calendarWeeks("2026-11-15").at(-1)?.at(-1)).toBe("2026-11-15");
  });
});

const day = (reviews: number) => ({ day: "2026-11-01", reviews, ms: 0 });

describe("levelsOf", () => {
  test("shades none as 0, then by the quartiles of the days with Reviews", () => {
    const level = levelsOf([1, 2, 3, 4, 5, 6, 7, 8].map(day));
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8, 100].map(level)).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4, 4]);
  });

  test("a year of the same count is all one level above none", () => {
    const level = levelsOf([5, 5, 5].map(day));
    expect(level(0)).toBe(0);
    expect(level(5)).toBe(1);
  });

  test("with no Reviews, every day is none", () => {
    expect(levelsOf([])(0)).toBe(0);
  });
});

describe("labels", () => {
  test("minutes round to whole ones, past an hour with hours", () => {
    expect(minutesLabel(0)).toBe("0 min");
    expect(minutesLabel(7 * 60_000 + 20_000)).toBe("7 min");
    expect(minutesLabel(209 * 60_000)).toBe("3 h 29 min");
  });

  test("the range reads as its days, or since its first day", () => {
    expect(rangeLabel({ range: "7", from: "2026-11-07" })).toBe("the last 7 days");
    expect(rangeLabel({ range: "all", from: "2026-06-29" })).toBe("since 29 Jun");
  });

  test("a Model reads by its curated name, or by its ID once it has left the list", () => {
    expect(modelName("anthropic/claude-haiku-5.5")).toBe("Claude Haiku 5.5");
    expect(modelName("gone/model-1")).toBe("gone/model-1");
  });
});
