import { describe, expect, test } from "bun:test";
import { ApiKeyRequest, SettingsPatch, effectiveAutoClose, isTimezone } from "./settings";

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

describe("SettingsPatch's model", () => {
  test("takes a Model on the list", () => {
    expect(SettingsPatch.parse({ model: "openai/gpt-6-luna" })).toEqual({
      model: "openai/gpt-6-luna",
    });
  });

  test("refuses a Model that isn't on the list", () => {
    expect(SettingsPatch.safeParse({ model: "openai/gpt-4o" }).success).toBe(false);
  });
});

describe("ApiKeyRequest", () => {
  test("trims the key", () => {
    expect(ApiKeyRequest.parse({ apiKey: "  sk-or-v1-abc\n" })).toEqual({ apiKey: "sk-or-v1-abc" });
  });

  test("takes 200 characters", () => {
    expect(ApiKeyRequest.safeParse({ apiKey: "k".repeat(200) }).success).toBe(true);
  });

  test.each([
    ["an empty key", ""],
    ["only spaces", "   "],
    ["201 characters", "k".repeat(201)],
  ])("refuses %s", (_, apiKey) => {
    expect(ApiKeyRequest.safeParse({ apiKey }).success).toBe(false);
  });
});

describe("effectiveAutoClose", () => {
  test("is the default, brackets, when none is stored", () => {
    expect(effectiveAutoClose(null)).toBe("brackets");
  });

  test("is the stored choice", () => {
    expect(effectiveAutoClose("off")).toBe("off");
    expect(effectiveAutoClose("brackets-and-dollar")).toBe("brackets-and-dollar");
  });

  test("reads one Banki no longer knows as the default", () => {
    expect(effectiveAutoClose("always")).toBe("brackets");
  });
});
