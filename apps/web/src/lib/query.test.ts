import { describe, expect, test } from "vitest";
import { ApiRequestError, shouldRetry } from "./query";

describe("shouldRetry", () => {
  test.each([401, 403])("never retries a %d", (status) => {
    expect(shouldRetry(0, new ApiRequestError(status))).toBe(false);
  });

  test.each([
    ["a 500", new ApiRequestError(500)],
    ["a network failure", new TypeError("Failed to fetch")],
  ])("retries %s up to 3 times", (_, error) => {
    expect([0, 1, 2, 3].map((failures) => shouldRetry(failures, error))).toEqual([
      true,
      true,
      true,
      false,
    ]);
  });
});
