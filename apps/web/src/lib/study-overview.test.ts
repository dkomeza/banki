import { describe, expect, test } from "vitest";
import {
  cardsLabel,
  estimateLabel,
  nextDayLabel,
  nextDueLabel,
  nothingToStudy,
  todayOf,
} from "./study-overview";

describe("estimateLabel", () => {
  test("rounds to whole minutes", () => {
    expect(estimateLabel(9 * 60_000)).toBe("~9 min");
    expect(estimateLabel(9 * 60_000 + 29_000)).toBe("~9 min");
    expect(estimateLabel(9 * 60_000 + 30_000)).toBe("~10 min");
    expect(estimateLabel(30_000)).toBe("~1 min");
  });

  test("says <1 min under a minute's rounding", () => {
    expect(estimateLabel(0)).toBe("<1 min");
    expect(estimateLabel(29_000)).toBe("<1 min");
  });
});

describe("nextDayLabel", () => {
  // Saturday 31 October 2026.
  const today = "2026-10-31";

  test("says tomorrow for the next Study day", () => {
    expect(nextDayLabel("2026-11-01", today)).toBe("tomorrow");
  });

  test("names the weekday within the next 6 days", () => {
    expect(nextDayLabel("2026-11-02", today)).toBe("Monday");
    expect(nextDayLabel("2026-11-06", today)).toBe("Friday");
  });

  test("gives the date beyond", () => {
    expect(nextDayLabel("2026-11-07", today)).toBe("7 Nov");
    expect(nextDayLabel("2026-11-12", today)).toBe("12 Nov");
  });
});

describe("nextDueLabel", () => {
  test("is the day and its count", () => {
    expect(nextDueLabel({ day: "2026-11-01", count: 14 }, "2026-10-31")).toBe("tomorrow, 14 cards");
    expect(nextDueLabel({ day: "2026-11-06", count: 1 }, "2026-10-31")).toBe("Friday, 1 card");
  });

  test("is undefined when no Card is ever due", () => {
    expect(nextDueLabel(null, "2026-10-31")).toBeUndefined();
  });
});

describe("todayOf", () => {
  test("is the Study day by the Timezone and Day start", () => {
    // 02:00 in Warsaw on 31 October is before the 4:00 Day start: still the 30th.
    const now = new Date("2026-10-31T01:00:00Z");
    expect(todayOf({ timezone: "Europe/Warsaw", dayStartHour: 4 }, now)).toBe("2026-10-30");
    expect(todayOf({ timezone: "Europe/Warsaw", dayStartHour: 0 }, now)).toBe("2026-10-31");
  });
});

test("cardsLabel", () => {
  expect(cardsLabel(1)).toBe("1 card");
  expect(cardsLabel(14)).toBe("14 cards");
});

test("nothingToStudy is nothing due and no New card", () => {
  const overview = { due: 0, new: 0, newTotal: 0, estimateMs: 0, nextDue: null };
  expect(nothingToStudy(overview)).toBe(true);
  expect(nothingToStudy({ ...overview, due: 1 })).toBe(false);
  expect(nothingToStudy({ ...overview, new: 1, newTotal: 1 })).toBe(false);
});
