// Saving one of a Deck's own settings as it changes (its Desired retention,
// its Macros): one PATCH at a time, in the order the changes were made, so
// the Deck ends up with the last one. Each change shows at once; one that
// fails is reported with its value, for Try again, until it is tried again
// or a newer change replaces it.

export type DeckSettingState<T> = {
  /** Changes not answered yet, in order; the first is being sent. */
  queue: readonly T[];
  /** Whether the last change saved a moment ago. */
  saved: boolean;
  /** The last change that didn't save, until it is tried again or replaced. */
  failed: { attempted: T } | undefined;
};

const SAVED_MS = 2000;

export function createDeckSettingSaver<T>({
  save,
  afterSaved = (clear) => {
    const timer = globalThis.setTimeout(clear, SAVED_MS);
    return () => globalThis.clearTimeout(timer);
  },
}: {
  /** Stores the value, throwing when that fails. */
  save: (value: T) => Promise<void>;
  /** Schedules clearing "Saved"; returns a cancel. */
  afterSaved?: (clear: () => void) => () => void;
}) {
  let state: DeckSettingState<T> = { queue: [], saved: false, failed: undefined };
  const listeners = new Set<() => void>();
  let cancelSaved: (() => void) | undefined;
  let disposed = false;

  const update = (next: Partial<DeckSettingState<T>>) => {
    state = { ...state, ...next };
    for (const listener of listeners) listener();
  };

  const sendNext = async () => {
    const value = state.queue[0];
    if (value === undefined) return;
    let ok = true;
    try {
      await save(value);
    } catch {
      ok = false;
    }
    if (disposed) return;
    const rest = state.queue.slice(1);
    if (!ok) {
      // A newer change is already queued: this one is moot.
      update({ queue: rest, failed: rest.length > 0 ? state.failed : { attempted: value } });
    } else {
      update({ queue: rest, failed: rest.length > 0 ? state.failed : undefined });
      if (rest.length === 0) {
        cancelSaved?.();
        cancelSaved = afterSaved(() => update({ saved: false }));
        update({ saved: true });
      }
    }
    void sendNext();
  };

  const change = (value: T) => {
    const idle = state.queue.length === 0;
    update({ queue: [...state.queue, value], saved: false, failed: undefined });
    if (idle) void sendNext();
  };

  return {
    getState: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    change,
    /** Sends the failed change again. */
    retry() {
      if (state.failed !== undefined) change(state.failed.attempted);
    },
    dispose() {
      disposed = true;
      cancelSaved?.();
      listeners.clear();
    },
  };
}

export type DeckSettingSaver<T> = ReturnType<typeof createDeckSettingSaver<T>>;
