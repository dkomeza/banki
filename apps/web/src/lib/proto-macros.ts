import { ParseError, renderToString } from "katex";
import { useSyncExternalStore } from "react";

// PROTOTYPE ONLY (BAN-22): Settings' and each Deck's Macros kept in the
// browser, with saves faked, so each Variant shows how the rows read and
// behave without the API. A plain load starts from what the Seed data will
// hold (Settings' \norm, \abs and \eps; Calculus 2's own \d and \eps). The
// `?state=` of the page sets where it starts instead, for every Deck alike:
//
// - `empty`: no Macros, in Settings or on the Deck.
// - `list`: several Macros, with and without arguments; the Deck has its own,
//   one of which overrides Settings' \eps.
// - `adding`: `list`, with a new row being written in each list.
// - `invalid`: a definition KaTeX rejects, and a name used twice.
// - `builtin`: a Macro named \R, which replaces KaTeX's own.
// - `save-error`: a change that failed to save, with its inline error.

export type Macro = { name: string; definition: string };

/** A Macro as it is being written: it may not be valid, and so not saved, yet. */
export type MacroRow = Macro & { id: string };

/** Where a list lives: Settings, or one Deck's own. */
export type Scope = "global" | { deck: string };

export type ProtoState = "empty" | "list" | "adding" | "invalid" | "builtin" | "save-error";

const STATES: readonly ProtoState[] = [
  "empty",
  "list",
  "adding",
  "invalid",
  "builtin",
  "save-error",
];

export function protoState(): ProtoState | undefined {
  const state = new URLSearchParams(window.location.search).get("state");
  return STATES.find((known) => known === state);
}

const CALCULUS_2 = "5eed0000-0000-4000-8000-000000000002";

const NORM = { name: "\\norm", definition: "\\left\\| #1 \\right\\|" };
const ABS = { name: "\\abs", definition: "\\left| #1 \\right|" };
const EPS = { name: "\\eps", definition: "\\varepsilon" };
const INNER = { name: "\\inner", definition: "\\left\\langle #1, #2 \\right\\rangle" };
const SEQ = { name: "\\seq", definition: "\\left( #1_n \\right)_{n \\ge 1}" };
const D = { name: "\\d", definition: "\\mathrm{d}" };
const OWN_EPS = { name: "\\eps", definition: "\\epsilon" };
const VAR = { name: "\\Var", definition: "\\operatorname{Var}\\left( #1 \\right)" };

let nextId = 0;
const row = (macro: Macro): MacroRow => ({ ...macro, id: `m${(nextId += 1)}` });

type Failure = { message: string; attempted: readonly MacroRow[] };

type Lists = {
  global: readonly MacroRow[];
  /** Each Deck's own list, by its ID; a Deck missing here starts from `deckDefault`. */
  decks: Readonly<Record<string, readonly MacroRow[]>>;
};

type State = Lists & {
  /** Rows just added, which a Variant opens or focuses. */
  fresh: readonly string[];
  saving: readonly string[];
  saved: readonly string[];
  failures: Readonly<Record<string, Failure>>;
};

const keyOf = (scope: Scope) => (scope === "global" ? "global" : scope.deck);

/** What a Deck's own list starts as in a `?state=`, for whichever Deck the page shows. */
function deckDefault(deck: string): readonly Macro[] {
  switch (protoState()) {
    case "empty":
      return [];
    case "list":
    case "adding":
      return [D, OWN_EPS, VAR];
    case "invalid":
      return [
        D,
        { name: "\\half", definition: "\\frac{1}{2" },
        { name: "\\d", definition: "\\,\\mathrm{d}" },
      ];
    case "builtin":
      return [D, { name: "\\R", definition: "\\mathbf{R}" }];
    case "save-error":
      return [D, OWN_EPS];
    default:
      return deck === CALCULUS_2 ? [D, OWN_EPS] : [];
  }
}

function globalDefault(): readonly Macro[] {
  switch (protoState()) {
    case "empty":
      return [];
    case "list":
    case "adding":
      return [NORM, ABS, EPS, INNER, SEQ];
    case "invalid":
      return [
        NORM,
        ABS,
        { name: "\\lnorm", definition: "\\left\\| #1 \\rght\\|" },
        { name: "\\abs", definition: "\\lvert #1 \\rvert" },
      ];
    case "builtin":
      return [NORM, { name: "\\R", definition: "\\mathbb{R}" }, ABS];
    default:
      return [NORM, ABS, EPS];
  }
}

function initial(): State {
  const global = globalDefault().map(row);
  const state = protoState();
  const fresh: string[] = [];
  let withNew = global;
  if (state === "adding") {
    const added = row({ name: "\\grad", definition: "\\nabla #1" });
    withNew = [...global, added];
    fresh.push(added.id);
  }
  const failures: Record<string, Failure> = {};
  if (state === "save-error") {
    // Renaming \abs to \absval failed: the row is back as it was.
    failures.global = {
      message: "Couldn't save \\absval: Banki didn't answer. The row is back to \\abs.",
      attempted: global.map((r) => (r.name === "\\abs" ? { ...r, name: "\\absval" } : r)),
    };
  }
  return { global: withNew, decks: {}, fresh, saving: [], saved: [], failures };
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
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

function rowsOf(current: State, scope: Scope): readonly MacroRow[] {
  if (scope === "global") return current.global;
  const own = current.decks[scope.deck];
  if (own !== undefined) return own;
  const made = deckDefault(scope.deck).map(row);
  const fresh: string[] = [];
  let rows = made;
  if (protoState() === "adding") {
    const added = row({ name: "\\E", definition: "\\mathbb{E}\\left[ #1 \\right]" });
    rows = [...made, added];
    fresh.push(added.id);
  }
  const failures = { ...current.failures };
  if (protoState() === "save-error") {
    failures[scope.deck] = {
      message: "Couldn't save deleting \\eps: Banki didn't answer. It's back in the list.",
      attempted: rows.filter((r) => r.name !== "\\eps"),
    };
  }
  // Remembered from first read, so a Deck's own rows keep their IDs.
  state = {
    ...current,
    decks: { ...current.decks, [scope.deck]: rows },
    fresh: [...current.fresh, ...fresh],
    failures,
  };
  return rows;
}

/** Saves a list as the User changed it, faking the round trip. */
function save(scope: Scope, rows: readonly MacroRow[], fresh = get().fresh) {
  const key = keyOf(scope);
  const current = get();
  const failures = { ...current.failures };
  delete failures[key];
  const savedBefore = savable(scope, rowsOf(current, scope));
  const lists: Lists =
    scope === "global"
      ? { global: rows, decks: current.decks }
      : { global: current.global, decks: { ...current.decks, [scope.deck]: rows } };
  const changed = JSON.stringify(savable(scope, rows, lists)) !== JSON.stringify(savedBefore);
  set({
    ...current,
    ...lists,
    fresh,
    failures,
    saving: changed ? [...current.saving.filter((k) => k !== key), key] : current.saving,
    saved: changed ? current.saved.filter((k) => k !== key) : current.saved,
  });
  if (!changed) return;
  window.setTimeout(() => {
    const now = get();
    set({ ...now, saving: now.saving.filter((k) => k !== key), saved: [...now.saved, key] });
    window.setTimeout(() => {
      const later = get();
      set({ ...later, saved: later.saved.filter((k) => k !== key) });
    }, 2000);
  }, 600);
}

/** The rows that would be saved: those with no problem. */
function savable(scope: Scope, rows: readonly MacroRow[], lists: Lists = get()): Macro[] {
  return rows
    .filter((r) => checkRow(r, rows, scope, lists).saved)
    .map(({ name, definition }) => ({ name, definition }));
}

// Actions --------------------------------------------------------------------

export function addMacro(scope: Scope, macro: Macro = { name: "\\", definition: "" }): string {
  const added = row(macro);
  save(scope, [...rowsOf(get(), scope), added], [...get().fresh, added.id]);
  return added.id;
}

export function changeMacro(scope: Scope, id: string, change: Partial<Macro>) {
  save(
    scope,
    rowsOf(get(), scope).map((r) => (r.id === id ? { ...r, ...change } : r)),
  );
}

export function deleteMacro(scope: Scope, id: string) {
  save(
    scope,
    rowsOf(get(), scope).filter((r) => r.id !== id),
    get().fresh.filter((f) => f !== id),
  );
}

/** Overrides one of Settings' Macros on a Deck: a row of its own with the same name. */
export function overrideMacro(deck: string, macro: Macro): string {
  return addMacro({ deck }, { ...macro });
}

export function retryMacros(scope: Scope) {
  const failure = get().failures[keyOf(scope)];
  if (failure !== undefined) save(scope, failure.attempted);
}

export function settle(id: string) {
  const current = get();
  if (current.fresh.includes(id)) set({ ...current, fresh: current.fresh.filter((f) => f !== id) });
}

// Reading ----------------------------------------------------------------------

export type Checked = {
  /** Whether the row is saved: it has no problem. */
  saved: boolean;
  /** Still being written: no name after the backslash, or no definition. Not an error yet. */
  incomplete: boolean;
  nameError?: string;
  definitionError?: string;
  /** The KaTeX command its name replaces, such as `\R`. */
  replaces?: string;
  /** How many arguments it takes: the highest `#n` in its definition. */
  arity: number;
  /** Its render with sample arguments, when it typesets. */
  html?: string;
  /** What it is written as with its sample arguments, such as `\norm{x}`. */
  sample: string;
};

const NAME = /^\\(?:[A-Za-z]+|[^A-Za-z])$/u;
const SAMPLES = ["x", "y", "z", "a", "b", "c", "u", "v", "w"];

export function arityOf(definition: string): number {
  let most = 0;
  for (const match of definition.matchAll(/#([1-9])/gu)) most = Math.max(most, Number(match[1]));
  return most;
}

const builtinCache = new Map<string, boolean>();
/** Whether KaTeX already knows `name`, on its own. */
export function isBuiltin(name: string): boolean {
  const cached = builtinCache.get(name);
  if (cached !== undefined) return cached;
  let known = true;
  try {
    renderToString(name, { throwOnError: true, strict: "ignore" });
  } catch (error) {
    known = !(
      error instanceof ParseError && error.rawMessage.startsWith("Undefined control sequence")
    );
  }
  builtinCache.set(name, known);
  return known;
}

function typeset(
  source: string,
  macros: Record<string, string>,
): { html: string } | { error: string } {
  try {
    return {
      html: renderToString(source, {
        throwOnError: true,
        strict: "ignore",
        trust: false,
        maxExpand: 1000,
        output: "html",
        macros: { ...macros },
      }),
    };
  } catch (error) {
    return { error: error instanceof ParseError ? error.rawMessage : "KaTeX can't typeset this." };
  }
}

/** Settings' saved Macros, which every Deck inherits. */
function globalSaved(lists: Lists): Macro[] {
  return lists.global.filter((r) => checkRow(r, lists.global, "global", lists).saved);
}

function macrosFor(scope: Scope, rows: readonly MacroRow[], lists: Lists, except?: string) {
  const map: Record<string, string> = {};
  if (scope !== "global") for (const m of globalSaved(lists)) map[m.name] = m.definition;
  for (const r of rows)
    if (r.id !== except && NAME.test(r.name) && r.definition.trim() !== "")
      map[r.name] = r.definition;
  return map;
}

export function checkRow(
  r: MacroRow,
  rows: readonly MacroRow[],
  scope: Scope,
  lists: Lists = get(),
): Checked {
  const arity = arityOf(r.definition);
  const sample = `${r.name}${SAMPLES.slice(0, arity)
    .map((s) => `{${s}}`)
    .join("")}`;
  const incomplete = r.name === "\\" || r.name === "" || r.definition.trim() === "";
  const checked: Checked = { saved: false, incomplete, arity, sample };
  if (r.name !== "\\" && r.name !== "" && !NAME.test(r.name)) {
    checked.nameError = r.name.startsWith("\\")
      ? "A name is \\ and letters, such as \\R, or \\ and one other character."
      : "A name starts with \\, such as \\R.";
  } else if (
    r.name !== "\\" &&
    rows.findIndex((other) => other.name === r.name) !== rows.indexOf(r)
  ) {
    checked.nameError = `${r.name} is already in this list.`;
  }
  if (r.definition.length > 1000) {
    checked.definitionError = `Up to 1,000 characters: this is ${r.definition.length.toLocaleString("en")}.`;
  }
  if (NAME.test(r.name) && isBuiltin(r.name)) checked.replaces = r.name;
  if (!incomplete && NAME.test(r.name) && checked.definitionError === undefined) {
    const macros = macrosFor(scope, rows, lists, r.id);
    macros[r.name] = r.definition;
    const result = typeset(sample, macros);
    if ("html" in result) checked.html = result.html;
    else checked.definitionError = result.error;
  } else if (!incomplete && checked.definitionError === undefined) {
    // A bad name still shows what its definition looks like.
    const result = typeset(
      r.definition.replace(/#([1-9])/gu, (_, n) => SAMPLES[Number(n) - 1] ?? "x"),
      macrosFor(scope, rows, lists, r.id),
    );
    if ("html" in result) checked.html = result.html;
    else checked.definitionError = result.error;
  }
  checked.saved =
    !incomplete && checked.nameError === undefined && checked.definitionError === undefined;
  return checked;
}

/** Renders a Macro's definition with a scope's Macros, for a read-only row. */
export function renderMacro(macro: Macro, scope: Scope): string {
  const current = get();
  const rows = rowsOf(get(), scope);
  const checked = checkRow(
    { ...macro, id: "" },
    rows.filter((r) => r.name !== macro.name),
    scope,
    current,
  );
  return checked.html ?? "";
}

export type ListView = {
  rows: readonly (MacroRow & { check: Checked })[];
  fresh: readonly string[];
  saveState: "saving" | "saved" | undefined;
  failure: string | undefined;
};

export type InheritedRow = Macro & {
  /** This Deck has its own of the same name, which wins. */
  overridden: boolean;
  html: string;
  arity: number;
};

function view(before: State, scope: Scope): ListView {
  const key = keyOf(scope);
  const rows = rowsOf(before, scope);
  // Reading a Deck's list the first time fills it in, with its fresh rows and failures.
  const current = get();
  return {
    rows: rows.map((r) => ({ ...r, check: checkRow(r, rows, scope, current) })),
    fresh: current.fresh,
    saveState: current.saving.includes(key)
      ? "saving"
      : current.saved.includes(key)
        ? "saved"
        : undefined,
    failure: current.failures[key]?.message,
  };
}

let version = 0;
const listViews = new Map<string, ListView>();
const inherited = new Map<string, readonly InheritedRow[]>();
const wrappedSubscribe = (listener: () => void) =>
  subscribe(() => {
    version += 1;
    listViews.clear();
    inherited.clear();
    listener();
  });

function memo<T>(cache: Map<string, T>, key: string, make: () => T): T {
  const hit = cache.get(`${version}:${key}`);
  if (hit !== undefined) return hit;
  const made = make();
  cache.set(`${version}:${key}`, made);
  return made;
}

/** One list (Settings' or a Deck's own), checked row by row, with its save state. */
export function useMacroList(scope: Scope): ListView {
  return useSyncExternalStore(wrappedSubscribe, () =>
    memo(listViews, keyOf(scope), () => view(get(), scope)),
  );
}

/** Settings' saved Macros as a Deck inherits them, each marked when the Deck overrides it. */
export function useInherited(deck: string): readonly InheritedRow[] {
  return useSyncExternalStore(wrappedSubscribe, () =>
    memo(inherited, deck, () => {
      const current = get();
      const own = rowsOf(current, { deck });
      const ownNames = new Set(
        own.filter((r) => checkRow(r, own, { deck }, current).saved).map((r) => r.name),
      );
      return globalSaved(current).map((m) => {
        const checked = checkRow({ ...m, id: "" }, [], "global", current);
        return {
          ...m,
          overridden: ownNames.has(m.name),
          html: checked.html ?? "",
          arity: checked.arity,
        };
      });
    }),
  );
}
