import type { SettingsPatch, SettingsResponse } from "@banki/shared";
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
  afterSaved = (clear) => {
    const timer = window.setTimeout(clear, SAVED_MS);
    return () => window.clearTimeout(timer);
  },
}: {
  initial: SettingsResponse;
  save: (patch: SettingsPatch) => Promise<SettingsResponse>;
  /** Called with each Settings the server answers. */
  onStored: (settings: SettingsResponse) => void;
  /** Schedules clearing a field's "Saved"; returns a cancel. */
  afterSaved?: (clear: () => void) => () => void;
}) {
  let state: SaverState = { stored: initial, queue: [], saving: [], saved: [], failures: [] };
  const listeners = new Set<() => void>();
  const savedTimers = new Map<Field, () => void>();
  // Settings the server stored meanwhile (the first fill, a refetch), held
  // until the queue drains, unless a later save's answer supersedes them.
  let arrived: SettingsResponse | undefined;

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
    const rest = state.queue.slice(1);
    const stillChanging = rest.some((next) => next.field === change.field);
    if (stored === undefined) {
      update({
        queue: rest,
        failures: [...without(state.failures, (failure) => failure.field === change.field), change],
      });
    } else {
      arrived = undefined;
      onStored(stored);
      update({
        stored,
        queue: rest,
        failures: without(state.failures, (failure) => failure.field === change.field),
      });
      if (!stillChanging) markSaved(change.field);
    }
    if (rest.length === 0 && arrived !== undefined) {
      update({ stored: arrived });
      arrived = undefined;
    }
    void sendNext();
  };

  const change = (next: Change) => {
    const idle = state.queue.length === 0;
    update({
      queue: [...state.queue, next],
      saved: without(state.saved, (field) => field === next.field),
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
      if (failed === undefined) return;
      update({ failures: without(state.failures, (failure) => failure.field === field) });
      change(failed);
    },
    /**
     * Takes Settings changed elsewhere (the first fill, say). While a save is
     * under way they wait for the queue to drain, and a later save's answer,
     * the server's state after it, replaces them.
     */
    sync(settings: SettingsResponse) {
      if (state.queue.length > 0) arrived = settings;
      else if (settings !== state.stored) update({ stored: settings });
    },
    dispose() {
      for (const cancel of savedTimers.values()) cancel();
      listeners.clear();
    },
  };
}

export type SettingsSaver = ReturnType<typeof createSettingsSaver>;
