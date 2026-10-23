import { describe, expect, test } from "bun:test";
import { ConfigError, PR_PREVIEW_RESOURCES, previewLimits, slugPreviewLimits } from "./config";

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

describe("the Slug Preview limits", () => {
  test("default to 9 running at once, api 128m / 0.5 CPU and web 48m / 0.25 CPU", () => {
    expect(slugPreviewLimits({})).toEqual({
      cap: 9,
      resources: { apiMemory: "128m", apiCpus: "0.5", webMemory: "48m", webCpus: "0.25" },
    });
  });

  test("leave the PR Previews' limits as they were: api 256m / 1 CPU, web 128m / 0.5 CPU", () => {
    expect(PR_PREVIEW_RESOURCES).toEqual({
      apiMemory: "256m",
      apiCpus: "1.0",
      webMemory: "128m",
      webCpus: "0.5",
    });
  });

  test("are read from the environment, empty values being the defaults", () => {
    expect(
      slugPreviewLimits({
        SLUG_PREVIEW_CAP: "3",
        SLUG_PREVIEW_API_MEMORY: "1g",
        SLUG_PREVIEW_API_CPUS: "2",
        SLUG_PREVIEW_WEB_MEMORY: " ",
        SLUG_PREVIEW_WEB_CPUS: ".5",
      }),
    ).toEqual({
      cap: 3,
      resources: { apiMemory: "1g", apiCpus: "2", webMemory: "48m", webCpus: ".5" },
    });
  });

  for (const cap of ["0", "-1", "2.5", "nine"]) {
    test(`refuse SLUG_PREVIEW_CAP=${cap}`, () => {
      expect(() => slugPreviewLimits({ SLUG_PREVIEW_CAP: cap })).toThrow(/SLUG_PREVIEW_CAP/);
    });
  }

  for (const name of ["SLUG_PREVIEW_API_MEMORY", "SLUG_PREVIEW_WEB_MEMORY"]) {
    for (const memory of ["0m", "5m", "128", "128M", "128mb", "1.5g", "-128m", "128 m", "lots"]) {
      test(`refuse ${name}=${memory}`, () => {
        expect(() => slugPreviewLimits({ [name]: memory })).toThrow(ConfigError);
        expect(() => slugPreviewLimits({ [name]: memory })).toThrow(new RegExp(name));
      });
    }
  }

  for (const name of ["SLUG_PREVIEW_API_CPUS", "SLUG_PREVIEW_WEB_CPUS"]) {
    for (const cpus of ["0", "0.0", "-1", "half", "1e2", "Infinity", "1."]) {
      test(`refuse ${name}=${cpus}`, () => {
        expect(() => slugPreviewLimits({ [name]: cpus })).toThrow(ConfigError);
        expect(() => slugPreviewLimits({ [name]: cpus })).toThrow(new RegExp(name));
      });
    }
  }
});
