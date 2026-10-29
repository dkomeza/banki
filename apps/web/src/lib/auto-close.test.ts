import { describe, expect, test } from "vitest";
import { autoCloseName, autoCloseSaveErrorText, matchAutoClose } from "./auto-close";

describe("auto-close as Settings shows it", () => {
  test("names each choice", () => {
    expect(autoCloseName("off")).toBe("Off");
    expect(autoCloseName("brackets")).toBe("Brackets");
    expect(autoCloseName("brackets-and-dollar")).toBe("Brackets and $");
  });

  test("says what a change that didn't save kept", () => {
    expect(autoCloseSaveErrorText("off", "brackets")).toBe(
      "The change to Off didn't save, so auto-close is still Brackets.",
    );
  });

  test("finds choices by name, ignoring case and spacing", () => {
    expect(matchAutoClose("").map((option) => option.value)).toEqual([
      "off",
      "brackets",
      "brackets-and-dollar",
    ]);
    expect(matchAutoClose("  BRACKETS ").map((option) => option.value)).toEqual([
      "brackets",
      "brackets-and-dollar",
    ]);
    expect(matchAutoClose("$").map((option) => option.value)).toEqual(["brackets-and-dollar"]);
  });
});
