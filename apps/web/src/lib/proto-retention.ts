import { useSyncExternalStore } from "react";
import type { ComboboxOption } from "@/components/settings/combobox";

// PROTOTYPE ONLY (BAN-23): Desired retention kept in the browser, with saves
// faked, so each Variant shows how the control reads without the API. The
// `?state=` of the page sets where it starts:
//
// - `follows`: every Deck follows Settings (90%), as a plain load does.
// - `own`: the Spanish deck (the seeded deck page) has its own 85%.
// - `picking`: the retention picker opens on load.
// - `save-error`: a change to 85% failed, with its inline error and Try again.

export const RETENTION_DEFAULT = 90;
export const RETENTION_MIN = 70;
export const RETENTION_MAX = 97;

/** The deck the seeded deck page shows: Spanish vocabulary. */
const SEED_DECK = "5eed0000-0000-4000-8000-000000000001";

export type ProtoState = "follows" | "own" | "picking" | "save-error" | undefined;

export function protoState(): ProtoState {
  const state = new URLSearchParams(window.location.search).get("state");
  return state === "follows" || state === "own" || state === "picking" || state === "save-error"
    ? state
    : undefined;
}

/** Where a value is set: Settings, or one Deck's own. */
export type Scope = "global" | { deck: string };

type Failure = { scope: Scope; attempted: number | null; kept: number | null };

type State = {
  global: number;
  decks: Readonly<Record<string, number>>;
  saving: readonly string[];
  saved: readonly string[];
  failures: readonly Failure[];
};

const keyOf = (scope: Scope) => (scope === "global" ? "global" : scope.deck);

function initial(): State {
  const state = protoState();
  const failures: Failure[] =
    state === "save-error"
      ? [
          { scope: "global", attempted: 85, kept: RETENTION_DEFAULT },
          { scope: { deck: SEED_DECK }, attempted: 85, kept: null },
        ]
      : [];
  return {
    global: RETENTION_DEFAULT,
    decks: state === "own" ? { [SEED_DECK]: 85 } : {},
    saving: [],
    saved: [],
    failures,
  };
}

let state: State | undefined;
const listeners = new Set<() => void>();
const get = () => {
  state ??= initial();
  return state;
};
const set = (next: State) => {
  state = next;
  for (const listener of listeners) listener();
};

/** Saves a value, faking the round trip; `null` on a Deck means "follow Settings". */
export function changeRetention(scope: Scope, value: number | null) {
  const key = keyOf(scope);
  const current = get();
  const decks = { ...current.decks };
  if (scope === "global") {
    if (value === null) return;
  } else if (value === null) delete decks[scope.deck];
  else decks[scope.deck] = value;
  set({
    ...current,
    global: scope === "global" && value !== null ? value : current.global,
    decks,
    saving: [...current.saving.filter((k) => k !== key), key],
    saved: current.saved.filter((k) => k !== key),
    failures: current.failures.filter((f) => keyOf(f.scope) !== key),
  });
  window.setTimeout(() => {
    const now = get();
    set({ ...now, saving: now.saving.filter((k) => k !== key), saved: [...now.saved, key] });
    window.setTimeout(() => {
      const later = get();
      set({ ...later, saved: later.saved.filter((k) => k !== key) });
    }, 2000);
  }, 700);
}

/** Tries a failed change again. */
export function retryRetention(scope: Scope) {
  const failure = get().failures.find((f) => keyOf(f.scope) === keyOf(scope));
  if (failure !== undefined) changeRetention(scope, failure.attempted);
}

export function useRetention() {
  const current = useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, get);
  return {
    global: current.global,
    /** The Deck's own value, or null while it follows Settings. */
    own: (deck: string): number | null => current.decks[deck] ?? null,
    /** What the Deck schedules with. */
    effective: (deck: string): number => current.decks[deck] ?? current.global,
    saveState: (scope: Scope): "saving" | "saved" | undefined =>
      current.saving.includes(keyOf(scope))
        ? "saving"
        : current.saved.includes(keyOf(scope))
          ? "saved"
          : undefined,
    failure: (scope: Scope) => current.failures.find((f) => keyOf(f.scope) === keyOf(scope)),
    /** How many Decks have their own value. */
    ownCount: Object.keys(current.decks).length,
    decksWithOwn: current.decks,
  };
}

/** What a failed save says, in the house style. */
export function retentionErrorText(failure: Failure, global: number): string {
  const tried = failure.attempted === null ? `following Settings` : `${failure.attempted}%`;
  const kept =
    failure.kept === null
      ? `it still follows Settings (${global}%)`
      : `it's still ${failure.kept}%`;
  return `The change to ${tried} didn't save, so ${kept}.`;
}

/** The whole percents 70–97, 90 marked as the default. */
export const PERCENT_OPTIONS: readonly ComboboxOption[] = Array.from(
  { length: RETENTION_MAX - RETENTION_MIN + 1 },
  (_, i) => {
    const value = RETENTION_MIN + i;
    return {
      value: String(value),
      label: `${value}%`,
      ...(value === RETENTION_DEFAULT ? { detail: "default" } : {}),
    };
  },
);

/** The percents a search finds: by number ("8" finds 80–89), or "default". */
export function matchPercents(
  options: readonly ComboboxOption[],
  query: string,
): readonly ComboboxOption[] {
  const wanted = query.trim().toLowerCase().replace("%", "");
  if (wanted === "") return options;
  return options.filter(
    (option) =>
      option.value.startsWith(wanted) ||
      option.label.toLowerCase().includes(wanted) ||
      (option.detail?.toLowerCase().includes(wanted) ?? false),
  );
}

/** Roughly how many of 10 cards come back when due, at a retention. */
export const outOfTen = (percent: number) => Math.round(percent / 10);
