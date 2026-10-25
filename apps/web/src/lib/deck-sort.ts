import { useSyncExternalStore } from "react";
import type { DeckSort } from "./decks";

/** Where this device keeps Home's sort, like the theme: it isn't a Setting. */
export const DECK_SORT_KEY = "banki.deckSort";

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;

export type DeckSortStore = {
  current: () => DeckSort;
  set: (sort: DeckSort) => void;
  /** Calls `listener` whenever the sort changes; returns a function that stops it. */
  subscribe: (listener: () => void) => () => void;
};

/**
 * Home's sort as `storage` remembers it: Alphabetical until Newest is chosen.
 * Storage that can't be read or written (a private window, say) leaves the
 * choice to last until the page reloads.
 */
export function createDeckSortStore(storage: () => Storage | undefined): DeckSortStore {
  const listeners = new Set<() => void>();
  let fallback: DeckSort = "alphabetical";
  const read = (): DeckSort => {
    try {
      const stored = storage()?.getItem(DECK_SORT_KEY);
      if (stored === "newest" || stored === "alphabetical") return stored;
      return stored === null || stored === undefined ? fallback : "alphabetical";
    } catch {
      return fallback;
    }
  };
  return {
    current: read,
    set: (sort) => {
      fallback = sort;
      try {
        storage()?.setItem(DECK_SORT_KEY, sort);
      } catch {
        // Kept in memory instead, as above.
      }
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

const store = createDeckSortStore(() => globalThis.localStorage);

/** Home's sort on this device, and a way to change it. */
export function useDeckSort(): [DeckSort, (sort: DeckSort) => void] {
  return [useSyncExternalStore(store.subscribe, store.current), store.set];
}
