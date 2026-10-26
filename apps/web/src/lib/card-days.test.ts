import { describe, expect, test } from "vitest";
import { byDay, dayLabel, timeLabel } from "./card-days";

// Local times, so the days don't depend on the machine's zone.
const local = (y: number, m: number, d: number, h = 12, min = 0) =>
  new Date(y, m - 1, d, h, min).toISOString();
const now = new Date(2026, 9, 26, 13, 0);

describe("dayLabel", () => {
  test("names today and yesterday, from midnight to midnight", () => {
    expect(dayLabel(local(2026, 10, 26, 0, 5), now)).toBe("Today");
    expect(dayLabel(local(2026, 10, 25, 23, 55), now)).toBe("Yesterday");
    expect(dayLabel(local(2026, 10, 25, 0, 0), now)).toBe("Yesterday");
  });

  test("dates an earlier day, with its year only before this one", () => {
    expect(dayLabel(local(2026, 10, 20), now)).toBe("Tue 20 Oct");
    expect(dayLabel(local(2025, 10, 20), now)).toBe("Mon 20 Oct 2025");
  });
});

describe("timeLabel", () => {
  test("shows the time on a 24-hour clock", () => {
    expect(timeLabel(local(2026, 10, 26, 9, 5))).toBe("09:05");
  });
});

describe("byDay", () => {
  test("puts Cards, newest first, in runs of one day each", () => {
    const items = [
      { id: "a", createdAt: local(2026, 10, 26, 11) },
      { id: "b", createdAt: local(2026, 10, 26, 8) },
      { id: "c", createdAt: local(2026, 10, 24, 20) },
    ];

    expect(byDay(items, now).map(({ day, items: of }) => [day, of.map((i) => i.id)])).toEqual([
      ["Today", ["a", "b"]],
      ["Sat 24 Oct", ["c"]],
    ]);
  });
});
