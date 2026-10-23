import { describe, expect, test } from "vitest";
import {
  dayStartEffect,
  describeStudyDay,
  formatHour,
  offsetOf,
  sameTimezone,
  saveErrorText,
} from "./time";

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
    ["UTC", "2026-01-15T12:00:00Z", "UTC"],
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
      saveErrorText({ field: "dayStartHour", attempted: 6 }, { timezone: "UTC", dayStartHour: 4 }),
    ).toBe("The change to 6:00 a.m. didn't save, so Day start is still 4:00 a.m.");
    expect(
      saveErrorText({ field: "dayStartHour", attempted: 4 }, { timezone: "UTC", dayStartHour: 0 }),
    ).toBe("The change to 4:00 a.m. didn't save, so Day start is still midnight.");
  });

  test("says which Timezone didn't save, and the one kept", () => {
    expect(
      saveErrorText(
        { field: "timezone", attempted: "Europe/London" },
        { timezone: "Europe/Warsaw", dayStartHour: 4 },
      ),
    ).toBe("The change to Europe/London didn't save, so Timezone is still Europe/Warsaw.");
    expect(
      saveErrorText(
        { field: "timezone", attempted: "Europe/London" },
        { timezone: null, dayStartHour: 4 },
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
      }),
    ).toBe(
      "Today's Study day runs from 3:00 a.m. on 29 March to 2:00 a.m. on 30 March, in Europe/Warsaw.",
    );
  });

  test("counts in UTC until a Timezone is stored", () => {
    expect(
      describeStudyDay(new Date("2026-05-12T12:00:00Z"), { timezone: null, dayStartHour: 0 }),
    ).toBe("Today's Study day runs from midnight on 12 May to midnight on 13 May, in UTC.");
  });
});
