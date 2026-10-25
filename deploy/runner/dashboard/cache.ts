// The Dashboard's live view is shared (ADR-0015): computed on demand, at
// most once every 30 seconds whatever the number of viewers, and never while
// nobody asks for it. A computation still running is shared too, and one that
// failed is kept for its 30 seconds like any other, so a broken Linear isn't
// asked again on every request. Each issue's Linear data is shared the same
// way, keyed by issue, for so many issues at most. Pure but for the clock it
// is given, so it is unit-tested.

export const LIVE_EVERY_MS = 30_000;

export type SharedView<T> = {
  /**
   * The view: the computation still running, the last one if it started
   * under 30 seconds ago, or a new computation.
   */
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
  let last: { startedAt: number; value: Promise<T>; running: boolean } | undefined;
  let settled: T | undefined;
  return {
    get() {
      const now = options.now();
      // A computation still running is shared however long it takes, so a
      // slow Linear or GitHub never has two going at once.
      if (last === undefined || (!last.running && now - last.startedAt >= everyMs)) {
        const current = { startedAt: now, value: options.compute(), running: true };
        last = current;
        current.value.then(
          (result) => {
            current.running = false;
            settled = result;
          },
          () => {
            current.running = false;
          },
        );
      }
      return last.value;
    },
    peek: () => settled,
  };
}

/** Shared views by key, such as an issue's Linear data: each one as `sharedView`'s. */
export type KeyedViews<K, T> = {
  get: (key: K) => Promise<T>;
  /** How many keys it keeps now. */
  size: () => number;
};

/**
 * A shared view per key, each computed on demand at most once every 30
 * seconds, keeping only the `max` keys asked for most recently.
 */
export function keyedViews<K, T>(options: {
  compute: (key: K) => Promise<T>;
  now: () => number;
  everyMs?: number;
  max: number;
}): KeyedViews<K, T> {
  const views = new Map<K, SharedView<T>>();
  return {
    get(key) {
      let view = views.get(key);
      if (view === undefined) {
        view = sharedView({
          compute: () => options.compute(key),
          now: options.now,
          everyMs: options.everyMs,
        });
      }
      // Newest last: a Map keeps the order keys went in.
      views.delete(key);
      views.set(key, view);
      for (const oldest of views.keys()) {
        if (views.size <= options.max) break;
        views.delete(oldest);
      }
      return view.get();
    },
    size: () => views.size,
  };
}
