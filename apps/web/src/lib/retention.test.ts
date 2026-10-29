import { describe, expect, test } from "vitest";
import {
  FOLLOW,
  PERCENT_OPTIONS,
  deckOptions,
  deckRetentionErrorText,
  deckRetentionLabel,
  globalRetentionErrorText,
  matchDeckOptions,
  matchPercents,
} from "./retention";

const values = (options: readonly { value: string }[]) => options.map((option) => option.value);

describe("PERCENT_OPTIONS", () => {
  test("are the whole percents 70–97, 90 marked as the default", () => {
    expect(PERCENT_OPTIONS).toHaveLength(28);
    expect(PERCENT_OPTIONS[0]).toEqual({ value: "70", label: "70%" });
    expect(PERCENT_OPTIONS.at(-1)).toEqual({ value: "97", label: "97%" });
    expect(PERCENT_OPTIONS.find((option) => option.value === "90")?.detail).toBe("default");
  });
});

describe("matchPercents", () => {
  test("finds by number, with or without %, or by default", () => {
    expect(values(matchPercents(PERCENT_OPTIONS, ""))).toHaveLength(28);
    expect(values(matchPercents(PERCENT_OPTIONS, "8"))).toEqual([
      "80",
      "81",
      "82",
      "83",
      "84",
      "85",
      "86",
      "87",
      "88",
      "89",
    ]);
    expect(values(matchPercents(PERCENT_OPTIONS, " 85% "))).toEqual(["85"]);
    expect(values(matchPercents(PERCENT_OPTIONS, "default"))).toEqual(["90"]);
    expect(matchPercents(PERCENT_OPTIONS, "60")).toEqual([]);
  });
});

describe("a Deck's choices", () => {
  test("put Follow Settings first, showing their value, and mark no percent as the default", () => {
    const options = deckOptions(85);

    expect(options[0]).toEqual({
      value: FOLLOW,
      label: "Follow Settings",
      display: "Follow Settings (85%)",
      detail: "85%",
    });
    expect(options.slice(1).every((option) => option.detail === undefined)).toBe(true);
    expect(options).toHaveLength(29);
  });

  test("are searched by follow or global, and by number", () => {
    const options = deckOptions(90);

    expect(values(matchDeckOptions(options, ""))).toHaveLength(29);
    expect(values(matchDeckOptions(options, "fol"))).toEqual([FOLLOW]);
    expect(values(matchDeckOptions(options, "Global"))).toEqual([FOLLOW]);
    expect(values(matchDeckOptions(options, "9"))).toEqual([
      "90",
      "91",
      "92",
      "93",
      "94",
      "95",
      "96",
      "97",
    ]);
  });
});

describe("what a failed save says", () => {
  test("in Settings, the percent tried and the one kept", () => {
    expect(globalRetentionErrorText(85, 90)).toBe(
      "The change to 85% didn't save, so it's still 90%.",
    );
  });

  test("on a Deck, a percent or following Settings, and what the Deck keeps", () => {
    expect(deckRetentionErrorText(85, null, 90)).toBe(
      "The change to 85% didn't save, so it still follows Settings (90%).",
    );
    expect(deckRetentionErrorText(null, 80, 90)).toBe(
      "The change to following Settings didn't save, so it's still 80%.",
    );
  });
});

describe("deckRetentionLabel", () => {
  test("says whether the Deck follows Settings or has its own", () => {
    expect(deckRetentionLabel(null, 90)).toBe("90% retention, from Settings");
    expect(deckRetentionLabel(85, 90)).toBe("its own 85% retention");
  });
});
