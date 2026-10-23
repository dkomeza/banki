import type { SettingsPatch, SettingsResponse } from "@banki/shared";
import { type SettingsRead, settingsClock } from "./settings";
import type { FailedSave } from "./time";

/** A change to one Setting: which, and the value it was changed to. */
export type Change = FailedSave;
export type Field = Change["field"];

export type SaverState = {
  /** The Settings as the server last answered them. */
  stored: SettingsResponse;
  /** Changes not answered yet, in the order they were made; the first is being sent. */
  queue: readonly Change[];
  /** Fields with a change waiting or being sent. */
  saving: readonly Field[];
  /** Fields whose last change saved a moment ago. */
  saved: readonly Field[];
  /** The last change to each field that didn't save, until it is tried again or replaced. */
  failures: readonly Change[];
};

/** The Settings as they show: the stored ones, with the changes not answered yet on top. */
export function shownSettings({ stored, queue }: SaverState): SettingsResponse {
  return queue.reduce<SettingsResponse>(
    (settings, change) => ({ ...settings, [change.field]: change.attempted }),
    stored,
  );
}

const SAVED_MS = 2000;

const without = <T>(list: readonly T[], drop: (item: T) => boolean) =>
  list.filter((item) => !drop(item));

/**
 * Saves Settings as they change, one PATCH at a time, in the order the changes
 * were made, so the server ends up with the last one and every answer is the
 * server's state after that change. Each change shows at once; one that fails
 * is reported (and its value goes back to the stored one) even when later
 * changes save.
 */
export function createSettingsSaver({
  initial,
  save,
  onStored,
  now = settingsClock,
  afterSaved = (clear) => {
    const timer = globalThis.setTimeout(clear, SAVED_MS);
    return () => globalThis.clearTimeout(timer);
  },
}: {
  initial: SettingsRead;
  save: (patch: SettingsPatch) => Promise<SettingsResponse>;
  /** Called with each save's answer, stamped when it arrived. */
  onStored: (read: SettingsRead) => void;
  /** The clock reads are stamped with (settingsClock). */
  now?: () => number;
  /** Schedules clearing a field's "Saved"; returns a cancel. */
  afterSaved?: (clear: () => void) => () => void;
}) {
  let state: SaverState = {
    stored: initial.settings,
    queue: [],
    saving: [],
    saved: [],
    failures: [],
  };
  // When what `stored` shows was true on the server: a read's issue time, or
  // when a save's answer arrived. A read issued earlier can't replace it: the
  // server may have changed since it was taken.
  let storedSince = initial.issuedAt;
  const listeners = new Set<() => void>();
  // Once disposed (signed out), answers still on their way change nothing.
  let disposed = false;
  const savedTimers = new Map<Field, () => void>();
  // A read that arrived while saving (the first fill, a refetch), held until
  // the queue drains, unless a later save's answer supersedes it.
  let arrived: SettingsRead | undefined;

  const update = (next: Partial<SaverState>) => {
    const merged = { ...state, ...next };
    state = { ...merged, saving: [...new Set(merged.queue.map((change) => change.field))] };
    for (const listener of listeners) listener();
  };

  const markSaved = (field: Field) => {
    savedTimers.get(field)?.();
    savedTimers.set(
      field,
      afterSaved(() => {
        savedTimers.delete(field);
        update({ saved: without(state.saved, (saved) => saved === field) });
      }),
    );
    update({ saved: [...without(state.saved, (saved) => saved === field), field] });
  };

  const sendNext = async () => {
    const change = state.queue[0];
    if (change === undefined) return;
    let stored: SettingsResponse | undefined;
    try {
      stored = await save({ [change.field]: change.attempted });
    } catch {
      stored = undefined;
    }
    if (disposed) return;
    const rest = state.queue.slice(1);
    const stillChanging = rest.some((next) => next.field === change.field);
    if (stored === undefined) {
      update({
        queue: rest,
        // A newer change to the field is already queued: this one is moot,
        // and its Try again would queue the old value after it.
        failures: stillChanging
          ? state.failures
          : [...without(state.failures, (failure) => failure.field === change.field), change],
      });
    } else {
      arrived = undefined;
      storedSince = now();
      onStored({ settings: stored, issuedAt: storedSince });
      update({
        stored,
        queue: rest,
        failures: without(state.failures, (failure) => failure.field === change.field),
      });
      if (!stillChanging) markSaved(change.field);
    }
    if (rest.length === 0 && arrived !== undefined) {
      const read = arrived;
      arrived = undefined;
      if (read.issuedAt >= storedSince) {
        storedSince = read.issuedAt;
        update({ stored: read.settings });
      }
    }
    void sendNext();
  };

  const change = (next: Change) => {
    const idle = state.queue.length === 0;
    update({
      queue: [...state.queue, next],
      saved: without(state.saved, (field) => field === next.field),
      // A newer change replaces the field's failed one: its Try again would
      // queue the old value after this and undo it.
      failures: without(state.failures, (failure) => failure.field === next.field),
    });
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
    /** Sends a field's failed change again. */
    retry(field: Field) {
      const failed = state.failures.find((failure) => failure.field === field);
      if (failed !== undefined) change(failed);
    },
    /**
     * Takes a read of the Settings from elsewhere: a refetch, the first fill,
     * or this saver's own answer coming back through the cache. A read issued
     * before what is shown was true (before the last save completed, say) is
     * stale and ignored. While a save is under way a read waits for the queue
     * to drain, and a later save's answer replaces it.
     */
    sync(read: SettingsRead) {
      if (read.issuedAt < storedSince) return;
      if (state.queue.length > 0) {
        if (arrived === undefined || read.issuedAt >= arrived.issuedAt) arrived = read;
        return;
      }
      storedSince = read.issuedAt;
      if (read.settings !== state.stored) update({ stored: read.settings });
    },
    dispose() {
      disposed = true;
      for (const cancel of savedTimers.values()) cancel();
      listeners.clear();
    },
  };
}

export type SettingsSaver = ReturnType<typeof createSettingsSaver>;
