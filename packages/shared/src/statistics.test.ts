import { describe, expect, test } from "bun:test";
import {
  Statistics,
  StatisticsQuery,
  calendarStartOf,
  mondayOf,
  statisticsRangeOf,
  studyDaysBetween,
} from "./statistics";

describe("StatisticsQuery", () => {
  test.each(["7", "30", "90", "all"])("takes the range %p", (range) => {
    expect(StatisticsQuery.parse({ range })).toEqual({ range });
  });

  test("defaults to 30 days", () => {
    expect(StatisticsQuery.parse({})).toEqual({ range: "30" });
  });

  test.each(["", "14", "ALL", "7d", "-7"])("refuses %p", (range) => {
    expect(StatisticsQuery.safeParse({ range }).success).toBe(false);
  });
});

describe("statisticsRangeOf", () => {
  test("takes a range, as a string or a number", () => {
    expect(statisticsRangeOf("7")).toBe("7");
    expect(statisticsRangeOf(90)).toBe("90");
    expect(statisticsRangeOf("all")).toBe("all");
  });

  test.each([undefined, null, "", "14", 14, "week", {}])("falls back to 30 for %p", (value) => {
    expect(statisticsRangeOf(value)).toBe("30");
  });
});

describe("weeks", () => {
  test("start on Monday", () => {
    expect(mondayOf("2026-11-09")).toBe("2026-11-09");
    expect(mondayOf("2026-11-13")).toBe("2026-11-09");
    expect(mondayOf("2026-11-15")).toBe("2026-11-09");
    expect(mondayOf("2026-01-01")).toBe("2025-12-29");
  });

  test("the calendar starts on the Monday 52 weeks before this week's", () => {
    const start = calendarStartOf("2026-11-13");
    expect(start).toBe("2025-11-10");
    expect(mondayOf(start)).toBe(start);
    expect(studyDaysBetween(start, "2026-11-15")).toBe(53 * 7);
  });

  test("count Study days with both ends", () => {
    expect(studyDaysBetween("2026-11-13", "2026-11-13")).toBe(1);
    expect(studyDaysBetween("2026-03-01", "2026-03-31")).toBe(31);
    // A DST change makes no difference to a count of calendar days.
    expect(studyDaysBetween("2026-03-28", "2026-03-30")).toBe(3);
  });
});

describe("Statistics", () => {
  const body: Statistics = {
    range: "30",
    from: "2026-10-15",
    to: "2026-11-13",
    calendar: [{ day: "2026-11-12", reviews: 4, ms: 60_000 }],
    minutes: { bucket: "day", points: [{ start: "2026-11-12", ms: 60_000 }] },
    actualRetention: { recalled: 3, total: 4, desiredRetention: 88.5 },
    cards: { new: 1, learning: 2, learned: 3 },
    graderAgreement: {
      kept: 2,
      higher: 1,
      lower: 0,
      models: [{ model: "a/b", kept: 2, higher: 1, lower: 0 }],
    },
  };

  test("takes the body", () => {
    expect(Statistics.parse(body)).toEqual(body);
  });

  test.each([
    { ...body, range: "14" },
    { ...body, from: "2026-02-30" },
    { ...body, minutes: { bucket: "month", points: [] } },
    { ...body, actualRetention: { recalled: 1, total: 1, desiredRetention: 101 } },
    { ...body, cards: { new: -1, learning: 0, learned: 0 } },
    { ...body, calendar: [{ day: "2026-11-12", reviews: 1.5, ms: 0 }] },
  ])("refuses a bad body", (bad) => {
    expect(Statistics.safeParse(bad).success).toBe(false);
  });
});
