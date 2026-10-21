import { describe, expect, test } from "bun:test";
import { ConfigError, previewLimits } from "./config";

// The limits come from agent.env, which a person edits by hand: a wrong value
// stops the agent on start instead of being guessed at.

describe("the Preview limits", () => {
  test("default to 5 running Previews and 7 idle days", () => {
    expect(previewLimits({})).toEqual({ cap: 5, idleDays: 7 });
  });

  test("an empty value, as an `env_file` line with nothing after `=` gives, is the default", () => {
    expect(previewLimits({ PREVIEW_CAP: "", PREVIEW_IDLE_DAYS: " " })).toEqual({
      cap: 5,
      idleDays: 7,
    });
  });

  test("are read from the environment", () => {
    expect(previewLimits({ PREVIEW_CAP: "2", PREVIEW_IDLE_DAYS: "14" })).toEqual({
      cap: 2,
      idleDays: 14,
    });
  });

  test("take decimal idle days, so 0.01 is about 15 minutes", () => {
    expect(previewLimits({ PREVIEW_IDLE_DAYS: "0.01" }).idleDays).toBe(0.01);
    expect(previewLimits({ PREVIEW_IDLE_DAYS: ".5" }).idleDays).toBe(0.5);
  });

  for (const cap of ["0", "-1", "2.5", "two", "1e3", "0x10", "Infinity", "5 Previews"]) {
    test(`refuse PREVIEW_CAP=${cap}`, () => {
      expect(() => previewLimits({ PREVIEW_CAP: cap })).toThrow(ConfigError);
      expect(() => previewLimits({ PREVIEW_CAP: cap })).toThrow(/PREVIEW_CAP/);
    });
  }

  for (const days of ["0", "0.0", "-7", "seven", "1e2", "Infinity", "NaN", "7d", "1."]) {
    test(`refuse PREVIEW_IDLE_DAYS=${days}`, () => {
      expect(() => previewLimits({ PREVIEW_IDLE_DAYS: days })).toThrow(ConfigError);
      expect(() => previewLimits({ PREVIEW_IDLE_DAYS: days })).toThrow(/PREVIEW_IDLE_DAYS/);
    });
  }
});
