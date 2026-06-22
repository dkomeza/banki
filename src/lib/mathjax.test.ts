import { describe, expect, it, vi } from "vitest";
import { waitForMathJaxStartup, type MathJaxRuntime } from "@/lib/mathjax";

describe("MathJax startup", () => {
  it("waits for asynchronous initialization before reporting readiness", async () => {
    let finishStartup: (() => void) | undefined;
    const runtime: MathJaxRuntime = {
      startup: { promise: new Promise<void>((resolve) => { finishStartup = resolve; }) },
    };
    const ready = waitForMathJaxStartup(runtime);
    let settled = false;
    void ready.then(() => { settled = true; });

    await Promise.resolve();
    expect(settled).toBe(false);

    runtime.typesetPromise = vi.fn(async () => undefined);
    finishStartup?.();
    await expect(ready).resolves.toBeUndefined();
  });

  it("rejects a runtime that has no typesetting API", async () => {
    await expect(waitForMathJaxStartup({})).rejects.toThrow("without a typesetting API");
  });
});
