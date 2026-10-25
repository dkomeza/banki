import { describe, expect, test } from "bun:test";
import { keyedViews, sharedView } from "./cache";

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

  test("shares a computation still running after 30 seconds, until it settles", async () => {
    const { view, computed, advance, settle } = setup();

    const first = view.get();
    advance(31_000);
    const again = view.get();

    expect(computed()).toBe(1);
    settle();
    expect(await first).toBe(1);
    expect(await again).toBe(1);
    // Settled, 31 seconds after it started: the next viewer starts another.
    const next = view.get();
    settle();
    expect(await next).toBe(2);
    expect(computed()).toBe(2);
  });

  test("shares a computation still running after 30 seconds that then fails, until it fails", async () => {
    let clock = 0;
    let calls = 0;
    const rejects: ((error: Error) => void)[] = [];
    const view = sharedView({
      compute: () => {
        calls += 1;
        return new Promise<number>((_, reject) => rejects.push(reject));
      },
      now: () => clock,
      everyMs: 30_000,
    });

    const first = view.get().catch(String);
    clock += 31_000;
    const again = view.get().catch(String);
    for (const reject of rejects.splice(0)) reject(new Error("Linear: HTTP 500"));

    expect(await first).toContain("HTTP 500");
    expect(await again).toContain("HTTP 500");
    expect(calls).toBe(1);
    void view.get().catch(() => undefined);
    expect(calls).toBe(2);
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

function keyed(max = 3) {
  let clock = 0;
  const computed: string[] = [];
  const views = keyedViews({
    compute: async (issue: string) => {
      computed.push(issue);
      return `${issue}#${computed.length}`;
    },
    now: () => clock,
    everyMs: 30_000,
    max,
  });
  return {
    views,
    computed,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe("each issue's data", () => {
  test("is computed once per issue every 30 seconds, whatever the number of requests", async () => {
    const { views, computed, advance } = keyed();

    await Promise.all([views.get("BAN-1"), views.get("BAN-1"), views.get("BAN-2")]);
    advance(29_999);
    expect(await views.get("BAN-1")).toBe("BAN-1#1");
    advance(1);
    expect(await views.get("BAN-1")).toBe("BAN-1#3");

    expect(computed).toEqual(["BAN-1", "BAN-2", "BAN-1"]);
  });

  test("shares an issue's computation still running after 30 seconds", async () => {
    let clock = 0;
    const computed: string[] = [];
    const resolvers: (() => void)[] = [];
    const views = keyedViews({
      compute: (issue: string) => {
        computed.push(issue);
        return new Promise<string>((resolve) => resolvers.push(() => resolve(issue)));
      },
      now: () => clock,
      everyMs: 30_000,
      max: 3,
    });

    const first = views.get("BAN-1");
    clock += 31_000;
    const again = views.get("BAN-1");
    for (const resolve of resolvers.splice(0)) resolve();

    expect(await Promise.all([first, again])).toEqual(["BAN-1", "BAN-1"]);
    expect(computed).toEqual(["BAN-1"]);
  });

  test("computes nothing for an issue nobody asks for", () => {
    const { computed, advance } = keyed();

    advance(10 * 60_000);

    expect(computed).toEqual([]);
  });

  test("keeps the issues asked for last, and so many at most", async () => {
    const { views, computed } = keyed(2);

    await views.get("BAN-1");
    await views.get("BAN-2");
    await views.get("BAN-1");
    await views.get("BAN-3");
    await views.get("BAN-1");
    await views.get("BAN-2");

    expect(computed).toEqual(["BAN-1", "BAN-2", "BAN-3", "BAN-2"]);
    expect(views.size()).toBe(2);
  });
});
