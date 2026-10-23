import { describe, expect, test } from "bun:test";
import { SettingsPatch, isTimezone } from "./settings";

describe("isTimezone", () => {
  test.each(["Europe/Warsaw", "UTC", "America/Argentina/Buenos_Aires", "Europe/Kiev"])(
    "accepts %s",
    (name) => {
      expect(isTimezone(name)).toBe(true);
    },
  );

  test.each(["Mars/Olympus_Mons", "", "+02:00", "-0500", "Warsaw"])("refuses %j", (name) => {
    expect(isTimezone(name)).toBe(false);
  });
});

describe("SettingsPatch", () => {
  test("takes either Setting, or both", () => {
    expect(SettingsPatch.parse({ dayStartHour: 0 })).toEqual({ dayStartHour: 0 });
    expect(SettingsPatch.parse({ timezone: "Asia/Tokyo", dayStartHour: 23 })).toEqual({
      timezone: "Asia/Tokyo",
      dayStartHour: 23,
    });
  });

  test.each([{ dayStartHour: 24 }, { dayStartHour: -1 }, { dayStartHour: 4.5 }, { theme: "dark" }])(
    "refuses %j",
    (body) => {
      expect(SettingsPatch.safeParse(body).success).toBe(false);
    },
  );
});
