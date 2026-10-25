// The Dashboard's live view is shared (ADR-0014): computed on demand, at
// most once every 30 seconds whatever the number of viewers, and never while
// nobody asks for it. A computation still running is shared too, and one that
// failed is kept for its 30 seconds like any other, so a broken Linear isn't
// asked again on every request. Pure but for the clock it is given, so it is
// unit-tested.

export const LIVE_EVERY_MS = 30_000;

export type SharedView<T> = {
  /** The view: the last one if it is under 30 seconds old, or a new computation. */
  get: () => Promise<T>;
  /** The last view that came out, if one did, without computing anything. */
  peek: () => T | undefined;
};

export function sharedView<T>(options: {
  compute: () => Promise<T>;
  now: () => number;
  everyMs?: number;
}): SharedView<T> {
  const everyMs = options.everyMs ?? LIVE_EVERY_MS;
  let last: { startedAt: number; value: Promise<T> } | undefined;
  let settled: T | undefined;
  return {
    get() {
      const now = options.now();
      if (last === undefined || now - last.startedAt >= everyMs) {
        const value = options.compute();
        last = { startedAt: now, value };
        value.then(
          (result) => {
            settled = result;
          },
          () => undefined,
        );
      }
      return last.value;
    },
    peek: () => settled,
  };
}
