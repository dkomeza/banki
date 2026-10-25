import { describe, expect, test, vi } from "vitest";
import { DECK_SORT_KEY, createDeckSortStore } from "./deck-sort";

const memory = (initial: Record<string, string> = {}) => {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
};

const unreadable = {
  getItem: () => {
    throw new DOMException("denied", "SecurityError");
  },
  setItem: () => {
    throw new DOMException("denied", "SecurityError");
  },
};

describe("createDeckSortStore", () => {
  test("is Alphabetical until Newest is chosen", () => {
    expect(createDeckSortStore(() => memory()).current()).toBe("alphabetical");
  });

  test("remembers the choice on this device, so it survives a reload", () => {
    const storage = memory();
    createDeckSortStore(() => storage).set("newest");

    expect(storage.getItem(DECK_SORT_KEY)).toBe("newest");
    expect(createDeckSortStore(() => storage).current()).toBe("newest");
  });

  test("reads anything else stored as Alphabetical", () => {
    expect(createDeckSortStore(() => memory({ [DECK_SORT_KEY]: "oldest" })).current()).toBe(
      "alphabetical",
    );
  });

  test("tells its listeners about a change", () => {
    const store = createDeckSortStore(() => memory());
    const listener = vi.fn();
    const stop = store.subscribe(listener);

    store.set("newest");
    stop();
    store.set("alphabetical");

    expect(listener).toHaveBeenCalledTimes(1);
  });

  test("keeps the choice until the page reloads when storage can't be used", () => {
    const store = createDeckSortStore(() => unreadable);

    store.set("newest");

    expect(store.current()).toBe("newest");
  });
});
