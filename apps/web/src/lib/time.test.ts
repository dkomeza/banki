import { describe, expect, test } from "vitest";
import {
  dayStartEffect,
  describeStudyDay,
  dayStartLabel,
  formatHour,
  matchHours,
  offsetOf,
  sameTimezone,
  saveErrorText,
} from "./time";

/** The Grading and Editor Settings, which these tests leave alone. */
const GRADING = {
  model: "anthropic/claude-haiku-5.5",
  apiKey: { state: "unset" },
  autoClose: "brackets",
  desiredRetention: 90,
} as const;

describe("formatHour", () => {
  test.each([
    [0, "midnight"],
    [4, "4:00 a.m."],
    [11, "11:00 a.m."],
    [12, "noon"],
    [13, "1:00 p.m."],
    [23, "11:00 p.m."],
  ])("%d is %s", (hour, text) => {
    expect(formatHour(hour)).toBe(text);
  });
});

describe("dayStartEffect", () => {
  test("says where the Study day runs, with a review just before the Day start", () => {
    expect(dayStartEffect(4)).toBe(
      "Each Study day runs from 4:00 a.m. to 4:00 a.m., so a review at 3:30 a.m. counts toward the day before.",
    );
    expect(dayStartEffect(1)).toBe(
      "Each Study day runs from 1:00 a.m. to 1:00 a.m., so a review at 12:30 a.m. counts toward the day before.",
    );
    expect(dayStartEffect(13)).toBe(
      "Each Study day runs from 1:00 p.m. to 1:00 p.m., so a review at 12:30 p.m. counts toward the day before.",
    );
  });

  test("at midnight, says Study days follow the calendar", () => {
    expect(dayStartEffect(0)).toBe("Study days follow the calendar: each one starts at midnight.");
  });
});

describe("offsetOf", () => {
  test.each([
    ["Europe/Warsaw", "2026-01-15T12:00:00Z", "UTC+1"],
    ["Europe/Warsaw", "2026-07-15T12:00:00Z", "UTC+2"],
    ["America/New_York", "2026-01-15T12:00:00Z", "UTC−5"],
    ["Asia/Kolkata", "2026-01-15T12:00:00Z", "UTC+5:30"],
    ["Asia/Kathmandu", "2026-01-15T12:00:00Z", "UTC+5:45"],
    ["America/St_Johns", "2026-01-15T12:00:00Z", "UTC−3:30"],
    ["Pacific/Kiritimati", "2026-01-15T12:00:00Z", "UTC+14"],
    // Zero offsets, which ICUs name "GMT", "GMT+0" or "UTC": always plain UTC.
    ["UTC", "2026-01-15T12:00:00Z", "UTC"],
    ["Etc/UTC", "2026-01-15T12:00:00Z", "UTC"],
    ["Africa/Abidjan", "2026-01-15T12:00:00Z", "UTC"],
    ["Europe/London", "2026-01-15T12:00:00Z", "UTC"],
  ])("%s on %s is %s", (zone, iso, offset) => {
    expect(offsetOf(zone, new Date(iso))).toBe(offset);
  });
});

describe("sameTimezone", () => {
  test("compares names in any case", () => {
    expect(sameTimezone("Europe/Warsaw", "europe/warsaw")).toBe(true);
    expect(sameTimezone("Europe/Warsaw", "Europe/London")).toBe(false);
  });
});

describe("saveErrorText", () => {
  test("says which Day start didn't save, and the one kept", () => {
    expect(
      saveErrorText(
        { field: "dayStartHour", attempted: 6 },
        { timezone: "UTC", dayStartHour: 4, ...GRADING },
      ),
    ).toBe("The change to 6:00 a.m. didn't save, so Day start is still 4:00 a.m.");
    expect(
      saveErrorText(
        { field: "dayStartHour", attempted: 4 },
        { timezone: "UTC", dayStartHour: 0, ...GRADING },
      ),
    ).toBe("The change to 4:00 a.m. didn't save, so Day start is still midnight.");
  });

  test("says which Timezone didn't save, and the one kept", () => {
    expect(
      saveErrorText(
        { field: "timezone", attempted: "Europe/London" },
        { timezone: "Europe/Warsaw", dayStartHour: 4, ...GRADING },
      ),
    ).toBe("The change to Europe/London didn't save, so Timezone is still Europe/Warsaw.");
    expect(
      saveErrorText(
        { field: "timezone", attempted: "Europe/London" },
        { timezone: null, dayStartHour: 4, ...GRADING },
      ),
    ).toBe("The change to Europe/London didn't save, so Banki still counts days in UTC.");
  });
});

describe("describeStudyDay", () => {
  test("says when the Study day a moment is in starts and ends, in the Timezone", () => {
    // 01:30 in Warsaw on 13 May, before the 4:00 a.m. Day start.
    expect(
      describeStudyDay(new Date("2026-05-12T23:30:00Z"), {
        timezone: "Europe/Warsaw",
        dayStartHour: 4,
        ...GRADING,
      }),
    ).toBe(
      "Today's Study day runs from 4:00 a.m. on 12 May to 4:00 a.m. on 13 May, in Europe/Warsaw.",
    );
  });

  test("on a day whose Day start a DST jump skips, says when it really starts", () => {
    expect(
      describeStudyDay(new Date("2026-03-29T12:00:00Z"), {
        timezone: "Europe/Warsaw",
        dayStartHour: 2,
        ...GRADING,
      }),
    ).toBe(
      "Today's Study day runs from 3:00 a.m. on 29 March to 2:00 a.m. on 30 March, in Europe/Warsaw.",
    );
  });

  test("counts in UTC until a Timezone is stored", () => {
    expect(
      describeStudyDay(new Date("2026-05-12T12:00:00Z"), {
        timezone: null,
        dayStartHour: 0,
        ...GRADING,
      }),
    ).toBe("Today's Study day runs from midnight on 12 May to midnight on 13 May, in UTC.");
  });
});

describe("dayStartLabel", () => {
  test.each([
    [0, "12:00 a.m. (midnight)"],
    [4, "4:00 a.m. (default)"],
    [12, "12:00 p.m. (noon)"],
    [18, "6:00 p.m."],
  ])("%d is %s", (hour, label) => {
    expect(dayStartLabel(hour)).toBe(label);
  });
});

describe("matchHours", () => {
  test("offers every hour, in order, before anything is typed", () => {
    expect(matchHours("")).toEqual(Array.from({ length: 24 }, (_, hour) => hour));
    expect(matchHours("   ")).toHaveLength(24);
  });

  test.each([
    ["6", [6, 18]],
    ["4", [4, 16]],
    ["12", [0, 12]],
    ["18", [18]],
    ["0", [0]],
    ["6p", [18]],
    ["6 pm", [18]],
    ["6 p.m.", [18]],
    ["6a", [6]],
    ["6:00 a.m.", [6]],
    ["6:3", []],
    ["mid", [0]],
    ["midnight", [0]],
    ["noon", [12]],
    ["NOON", [12]],
    ["default", [4]],
    ["4:00 a.m. (default)", [4]],
    ["12:00 a.m. (midnight)", [0]],
    ["24", []],
    ["13pm", []],
    ["banana", []],
  ])("%j offers %j", (query, hours) => {
    expect(matchHours(query)).toEqual(hours);
  });

  test("a.m. or p.m. alone offers that half of the day", () => {
    expect(matchHours("pm")).toEqual([12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]);
    expect(matchHours("a.m.")).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });
});
