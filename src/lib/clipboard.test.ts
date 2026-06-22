import { afterEach, describe, expect, it, vi } from "vitest";
import { copyText } from "@/lib/clipboard";

afterEach(() => vi.unstubAllGlobals());

describe("copyText", () => {
  it("uses the modern clipboard API when available", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    await expect(copyText("prompt", { writeText })).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("prompt");
  });

  it("returns false when no clipboard mechanism is available", async () => {
    vi.stubGlobal("document", undefined);
    await expect(copyText("prompt", null)).resolves.toBe(false);
  });
});
