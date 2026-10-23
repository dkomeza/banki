import { describe, expect, spyOn, test } from "bun:test";
import { lookUp } from "./ghcr";

// What a build's lookup tells the planners: found, confirmed missing, or
// unknown. Only an answer from GHCR confirms an image missing, so only that
// can time a Slug Preview's Deployment out.

const SHA = "a".repeat(40);
const digests = { api: `sha256:${"1".repeat(64)}`, web: `sha256:${"2".repeat(64)}` };

describe("looking up a build's images", () => {
  test("gives the digests when both exist", async () => {
    expect(await lookUp("blue", SHA, () => Promise.resolve(digests))).toEqual({ digests });
  });

  test("is `missing` when GHCR answered that either isn't there", async () => {
    expect(await lookUp("blue", SHA, () => Promise.resolve(undefined))).toBe("missing");
  });

  test("is `failed`, not missing, when GHCR couldn't be asked", async () => {
    const error = spyOn(console, "error").mockImplementation(() => {});
    try {
      const outcome = await lookUp("blue", SHA, () => Promise.reject(new Error("HTTP 502")));

      expect(outcome).toBe("failed");
      expect(String(error.mock.calls[0]?.[0])).toContain("banki-slug-blue");
    } finally {
      error.mockRestore();
    }
  });
});
