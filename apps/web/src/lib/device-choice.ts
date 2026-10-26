import { useSyncExternalStore } from "react";

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;

export type DeviceChoiceStore<T extends string> = {
  current: () => T;
  set: (choice: T) => void;
  /** Calls `listener` whenever the choice changes; returns a function that stops it. */
  subscribe: (listener: () => void) => () => void;
};

/**
 * A choice that belongs to this device, like the theme, rather than a Setting:
 * kept in `storage` under `key`, `fallback` until one of `choices` is picked,
 * and anything else stored read as `fallback`. Storage that can't be read or
 * written (a private window, say) leaves the choice to last until the page
 * reloads.
 */
export function createDeviceChoiceStore<T extends string>(
  key: string,
  choices: readonly T[],
  fallback: T,
  storage: () => Storage | undefined,
): DeviceChoiceStore<T> {
  const listeners = new Set<() => void>();
  let inMemory = fallback;
  const isChoice = (value: unknown): value is T => choices.some((choice) => choice === value);
  const read = (): T => {
    try {
      const stored = storage()?.getItem(key);
      if (isChoice(stored)) return stored;
      return stored === null || stored === undefined ? inMemory : fallback;
    } catch {
      return inMemory;
    }
  };
  return {
    current: read,
    set: (choice) => {
      inMemory = choice;
      try {
        storage()?.setItem(key, choice);
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

/** A device choice from `store`, and a way to change it. */
export function useDeviceChoice<T extends string>(
  store: DeviceChoiceStore<T>,
): [T, (choice: T) => void] {
  return [useSyncExternalStore(store.subscribe, store.current), store.set];
}
