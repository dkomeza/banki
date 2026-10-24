import { describe, expect, test } from "bun:test";
import { dispatcherConfig } from "./config";

// The Dispatcher's settings, from the environment compose.yaml fills.

describe("the Dispatcher's settings", () => {
  test("default to every night 01:00–07:00, the weekend, a Ceiling of 60% and 2 Stages", () => {
    expect(dispatcherConfig({})).toEqual({
      window: { night: { start: 60, end: 420 }, openDays: new Set([6, 0]) },
      ceiling: 0.6,
      maxStages: 2,
      timeZone: undefined,
    });
  });

  test("take each from its env var, empty ones aside", () => {
    expect(
      dispatcherConfig({
        BANKI_RUNNER_NIGHT: "22:00-06:00",
        BANKI_RUNNER_OPEN_DAYS: "sun",
        BANKI_RUNNER_CEILING: "0.45",
        BANKI_RUNNER_MAX_STAGES: "",
        TZ: "Europe/Warsaw",
      }),
    ).toEqual({
      window: { night: { start: 1320, end: 360 }, openDays: new Set([0]) },
      ceiling: 0.45,
      maxStages: 2,
      timeZone: "Europe/Warsaw",
    });
  });

  test("refuse a Ceiling that isn't a share, a cap that isn't a whole number, and a TZ that isn't a timezone", () => {
    expect(() => dispatcherConfig({ BANKI_RUNNER_CEILING: "60" })).toThrow("BANKI_RUNNER_CEILING");
    expect(() => dispatcherConfig({ BANKI_RUNNER_CEILING: "0" })).toThrow("BANKI_RUNNER_CEILING");
    expect(() => dispatcherConfig({ BANKI_RUNNER_MAX_STAGES: "1.5" })).toThrow(
      "BANKI_RUNNER_MAX_STAGES",
    );
    expect(() => dispatcherConfig({ BANKI_RUNNER_MAX_STAGES: "0" })).toThrow(
      "BANKI_RUNNER_MAX_STAGES",
    );
    expect(() => dispatcherConfig({ TZ: "Mars/Olympus" })).toThrow("TZ");
  });
});
