import { describe, expect, test } from "bun:test";
import { sharedView } from "./cache";

// The live view, computed on demand at most once every 30 seconds and
// shared by every viewer, on a fake clock.

function setup() {
  let clock = 0;
  let computed = 0;
  const pending: (() => void)[] = [];
  const view = sharedView({
    compute: () => {
      computed += 1;
      const n = computed;
      return new Promise<number>((resolve) => pending.push(() => resolve(n)));
    },
    now: () => clock,
    everyMs: 30_000,
  });
  return {
    view,
    computed: () => computed,
    advance: (ms: number) => {
      clock += ms;
    },
    settle: () => {
      for (const resolve of pending.splice(0)) resolve();
    },
  };
}

describe("the live view", () => {
  test("computes nothing while nobody asks for it", () => {
    const { view, computed, advance } = setup();

    advance(10 * 60_000);

    expect(computed()).toBe(0);
    expect(view.peek()).toBeUndefined();
  });

  test("is computed once for any number of viewers, even while the first computation runs", async () => {
    const { view, computed, settle } = setup();

    const asked = Array.from({ length: 50 }, () => view.get());
    settle();

    expect(await Promise.all(asked)).toEqual(Array.from({ length: 50 }, () => 1));
    expect(computed()).toBe(1);
  });

  test("is computed again only once 30 seconds have passed since the last one started", async () => {
    const { view, computed, advance, settle } = setup();
    const first = view.get();
    settle();
    await first;

    advance(29_999);
    expect(await view.get()).toBe(1);
    advance(1);
    const second = view.get();
    settle();

    expect(await second).toBe(2);
    expect(computed()).toBe(2);
    expect(view.peek()).toBe(2);
  });

  test("keeps a computation that failed for its 30 seconds too, so a broken Linear isn't hammered", async () => {
    let calls = 0;
    let clock = 0;
    const view = sharedView({
      compute: async () => {
        calls += 1;
        throw new Error("Linear: HTTP 500");
      },
      now: () => clock,
      everyMs: 30_000,
    });

    const failure = () => view.get().then(String, (error: unknown) => String(error));

    expect(await failure()).toContain("HTTP 500");
    expect(await failure()).toContain("HTTP 500");
    clock += 30_000;
    expect(await failure()).toContain("HTTP 500");

    expect(calls).toBe(2);
    expect(view.peek()).toBeUndefined();
  });
});
