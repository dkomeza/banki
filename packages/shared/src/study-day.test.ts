import { describe, expect, test } from "bun:test";
import { studyDayBounds, studyDayOf } from "./study-day";

const at = (iso: string) => new Date(iso);
const warsaw = (dayStartHour: number) => ({ timezone: "Europe/Warsaw", dayStartHour });

describe("studyDayOf", () => {
  test("a 1:00 a.m. moment belongs to the previous Study day with Day start 4", () => {
    const settings = { timezone: "UTC", dayStartHour: 4 };

    expect(studyDayOf(at("2026-05-12T01:00:00Z"), settings)).toBe("2026-05-11");
    expect(studyDayOf(at("2026-05-12T03:59:59.999Z"), settings)).toBe("2026-05-11");
    expect(studyDayOf(at("2026-05-12T04:00:00Z"), settings)).toBe("2026-05-12");
  });

  test("Day start 0 follows the calendar", () => {
    const settings = { timezone: "UTC", dayStartHour: 0 };

    expect(studyDayOf(at("2026-05-11T23:59:59Z"), settings)).toBe("2026-05-11");
    expect(studyDayOf(at("2026-05-12T00:00:00Z"), settings)).toBe("2026-05-12");
    expect(studyDayOf(at("2026-05-12T01:00:00Z"), settings)).toBe("2026-05-12");
  });

  test("counts in the User's Timezone, not UTC", () => {
    // New York is UTC-4 in May: 4:00 a.m. there is 08:00Z.
    const settings = { timezone: "America/New_York", dayStartHour: 4 };

    expect(studyDayOf(at("2026-05-12T07:59:00Z"), settings)).toBe("2026-05-11");
    expect(studyDayOf(at("2026-05-12T08:00:00Z"), settings)).toBe("2026-05-12");
    // 23:30 on the 12th in New York is already the 13th in UTC.
    expect(studyDayOf(at("2026-05-13T03:30:00Z"), settings)).toBe("2026-05-12");
  });

  test("uses UTC when no Timezone is stored", () => {
    const settings = { timezone: null, dayStartHour: 4 };

    expect(studyDayOf(at("2026-05-12T03:59:00Z"), settings)).toBe("2026-05-11");
    expect(studyDayOf(at("2026-05-12T04:00:00Z"), settings)).toBe("2026-05-12");
  });
});

describe("studyDayBounds", () => {
  test("runs from one Day start to the next in the User's Timezone", () => {
    // Warsaw is UTC+2 in May.
    expect(studyDayBounds("2026-05-12", { timezone: "Europe/Warsaw", dayStartHour: 4 })).toEqual({
      start: at("2026-05-12T02:00:00Z"),
      end: at("2026-05-13T02:00:00Z"),
    });
  });

  test("uses UTC when no Timezone is stored", () => {
    expect(studyDayBounds("2026-05-12", { timezone: null, dayStartHour: 0 })).toEqual({
      start: at("2026-05-12T00:00:00Z"),
      end: at("2026-05-13T00:00:00Z"),
    });
  });
});

describe("across a DST change", () => {
  // Warsaw springs forward on 2026-03-29, 2:00 CET straight to 3:00 CEST
  // (01:00Z), and falls back on 2026-10-25, 3:00 CEST back to 2:00 CET (01:00Z).

  test("a Day start hour skipped by the jump starts the Study day at the first moment after the gap", () => {
    const { start, end } = studyDayBounds("2026-03-29", warsaw(2));

    // 3:00 CEST, the first moment after 1:59:59 CET.
    expect(start).toEqual(at("2026-03-29T01:00:00Z"));
    // The next day's 2:00 CEST: a day 23 hours long.
    expect(end).toEqual(at("2026-03-30T00:00:00Z"));
    expect(studyDayOf(at("2026-03-29T00:59:59Z"), warsaw(2))).toBe("2026-03-28");
    expect(studyDayOf(at("2026-03-29T01:00:00Z"), warsaw(2))).toBe("2026-03-29");
  });

  test("a Day start hour that happens twice starts the Study day at its first occurrence", () => {
    const { start, end } = studyDayBounds("2026-10-25", warsaw(2));

    // The first 2:00, still CEST.
    expect(start).toEqual(at("2026-10-25T00:00:00Z"));
    // The next day's 2:00 CET: a day 25 hours long.
    expect(end).toEqual(at("2026-10-26T01:00:00Z"));
    expect(studyDayOf(at("2026-10-24T23:59:59Z"), warsaw(2))).toBe("2026-10-24");
    expect(studyDayOf(at("2026-10-25T00:00:00Z"), warsaw(2))).toBe("2026-10-25");
    // The second 2:30, now CET, stays in the same Study day.
    expect(studyDayOf(at("2026-10-25T01:30:00Z"), warsaw(2))).toBe("2026-10-25");
  });

  test("a Day start away from the change keeps its hour on both sides", () => {
    expect(studyDayBounds("2026-03-29", warsaw(4))).toEqual({
      start: at("2026-03-29T02:00:00Z"),
      end: at("2026-03-30T02:00:00Z"),
    });
    expect(studyDayBounds("2026-10-25", warsaw(4))).toEqual({
      start: at("2026-10-25T03:00:00Z"),
      end: at("2026-10-26T03:00:00Z"),
    });
  });

  test("a skipped midnight starts a calendar Study day at the first moment after the gap", () => {
    // Santiago springs forward on 2026-09-06 from 00:00 (UTC-4) straight to
    // 01:00 (UTC-3), at 04:00Z: that day has no midnight.
    const santiago = { timezone: "America/Santiago", dayStartHour: 0 };

    expect(studyDayBounds("2026-09-06", santiago).start).toEqual(at("2026-09-06T04:00:00Z"));
    expect(studyDayBounds("2026-09-05", santiago).end).toEqual(at("2026-09-06T04:00:00Z"));
    expect(studyDayOf(at("2026-09-06T03:59:59Z"), santiago)).toBe("2026-09-05");
    expect(studyDayOf(at("2026-09-06T04:00:00Z"), santiago)).toBe("2026-09-06");
  });
});
