import {
  effectiveMacros,
  type Macro,
  MACRO_DEFINITION_MAX_LENGTH,
  macroArity,
  MACROS_MAX,
} from "@banki/shared";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createContext, useContext, useMemo } from "react";
import { knownToKatex, NO_MACROS, typeset } from "./formula";
import { settingsQueryOptions } from "./settings";

// Macros in the browser: a Deck's effective Macros for its Cards to render
// with, and the checks a Macro's row makes as it is written. Settings' and a
// Deck's own lists are stored whole; the browser merges them (Settings' with
// the Deck's own on top) and typesets each Formula with the result.

/** The Macros the Cards rendered inside it use: their Deck's effective Macros. */
export const MacrosContext = createContext<readonly Macro[]>(NO_MACROS);

/** The Macros a Card rendered here uses. */
export const useMacros = () => useContext(MacrosContext);

/** `macros` as one string, the same for two lists alike. */
const keyOf = (macros: readonly Macro[]) =>
  JSON.stringify(macros.map((macro) => [macro.name, macro.definition]));

/**
 * Settings' Macros with `own` on top: a Deck's effective Macros. The list
 * keeps its identity while it reads the same, so what renders with it
 * typesets again only when a Macro changes. Settings' come from the cache,
 * and follow it as they are saved; until they are loaded, it suspends, so no
 * Card renders without them.
 */
export function useEffectiveMacros(own: readonly Macro[] | undefined): readonly Macro[] {
  const settings = useSuspenseQuery(settingsQueryOptions()).data.settings.macros;
  const mine = own ?? NO_MACROS;
  const key = `${keyOf(settings)}${keyOf(mine)}`;
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => effectiveMacros(settings, mine), [key]);
}

// Writing a Macro -------------------------------------------------------------

/**
 * A Macro as it is being written, in its list: maybe not valid, and so not
 * saved, yet. `kept` is the version of it last sent to be saved, which the
 * list keeps while the row has a problem; none for a row never saved.
 */
export type MacroRow = Macro & { id: string; kept?: Macro | undefined };

/** What a row's checks found. */
export type Checked = {
  /** Whether it is saved: it is written and has no problem. */
  saved: boolean;
  /** Still being written: no name after the `\`, or no definition. Not a problem yet. */
  incomplete: boolean;
  nameError?: string;
  definitionError?: string;
  /** The KaTeX command its name replaces, such as `\R`. */
  replaces?: string;
  /** How many arguments it takes: the highest `#n` in its definition. */
  arity: number;
  /** Its render with sample arguments, when it typesets. */
  html?: string;
  /** How it is written with its sample arguments, such as `\norm{x}`. */
  sample: string;
};

/** `\` and letters, or `\` and one other character: how a TeX command is named. */
const NAME = /^\\(?:[A-Za-z]+|[^A-Za-z])$/u;

/** The sample arguments a Macro is typeset with, one per argument. */
const SAMPLES = ["x", "y", "z", "a", "b", "c", "u", "v", "w"];

/** `name` written with `arity` sample arguments: `\norm{x}`. */
export const sampleOf = (name: string, arity: number) =>
  `${name}${SAMPLES.slice(0, arity)
    .map((sample) => `{${sample}}`)
    .join("")}`;

/**
 * Whether `row` repeats another row's name: the one that took the name
 * from the other, which had it saved, or else the later of the two.
 */
function repeats(row: MacroRow, rows: readonly MacroRow[]): boolean {
  const has = (r: MacroRow) => r.kept?.name === r.name;
  const index = rows.indexOf(row);
  return rows.some(
    (other, i) =>
      other !== row &&
      other.name === row.name &&
      (has(other) === has(row) ? i < index : has(other)),
  );
}

/**
 * The checks of `row`, one of `rows` (its list), typeset with sample
 * arguments on top of `under` (Settings' Macros, for a Deck's own) and the
 * list's other Macros, so a Macro may use another.
 */
export function checkRow(row: MacroRow, rows: readonly MacroRow[], under: readonly Macro[]) {
  const arity = macroArity(row.definition);
  const sample = sampleOf(row.name, arity);
  const incomplete = row.name === "\\" || row.name === "" || row.definition.trim() === "";
  const checked: Checked = { saved: false, incomplete, arity, sample };
  const index = rows.indexOf(row);
  if (row.name !== "\\" && row.name !== "" && !NAME.test(row.name)) {
    checked.nameError = row.name.startsWith("\\")
      ? "A name is \\ and letters, such as \\R, or \\ and one other character."
      : "A name starts with \\, such as \\R.";
  } else if (row.name !== "\\" && repeats(row, rows)) {
    checked.nameError = `${row.name} is already in this list.`;
  } else if (index >= MACROS_MAX) {
    checked.nameError = `A list holds up to ${MACROS_MAX} macros.`;
  }
  if (row.definition.length > MACRO_DEFINITION_MAX_LENGTH) {
    checked.definitionError = `Up to ${MACRO_DEFINITION_MAX_LENGTH.toLocaleString("en-GB")} characters: this is ${row.definition.length.toLocaleString("en-GB")}.`;
  }
  if (NAME.test(row.name) && knownToKatex(row.name)) checked.replaces = row.name;
  if (!incomplete && checked.definitionError === undefined) {
    const others = rows.filter(
      (other) => other !== row && NAME.test(other.name) && other.definition.trim() !== "",
    );
    const macros = effectiveMacros(under, others);
    // A bad name still shows what its definition looks like.
    const result = NAME.test(row.name)
      ? typeset(sample, false, [...macros.filter((m) => m.name !== row.name), row])
      : typeset(
          row.definition.replace(/#([1-9])/gu, (_, n: string) => SAMPLES[Number(n) - 1] ?? "x"),
          false,
          macros,
        );
    if ("html" in result) checked.html = result.html;
    else checked.definitionError = result.error;
  }
  checked.saved =
    !incomplete && checked.nameError === undefined && checked.definitionError === undefined;
  return checked;
}

/**
 * The list `rows` save, and the rows with what each sends as their `kept`:
 * a row written with no problem sends itself; one with a problem, or still
 * being written, keeps the version of it last sent, so the Macro stays as it
 * was saved until the row is fixed. A row with a problem whose kept name
 * another row now has sends nothing.
 */
export function toSave(
  rows: readonly MacroRow[],
  under: readonly Macro[],
): { rows: MacroRow[]; list: Macro[] } {
  const saved = new Set(rows.filter((row) => checkRow(row, rows, under).saved));
  const names = new Set([...saved].map((row) => row.name));
  const list: Macro[] = [];
  const next = rows.map((row): MacroRow => {
    if (saved.has(row)) {
      const kept = { name: row.name, definition: row.definition };
      list.push(kept);
      return { ...row, kept };
    }
    if (row.kept === undefined || names.has(row.kept.name)) return { ...row, kept: undefined };
    names.add(row.kept.name);
    list.push(row.kept);
    return row;
  });
  return { rows: next, list };
}

/** The list the rows sent last: each row's `kept`. */
export const keptOf = (rows: readonly MacroRow[]): Macro[] =>
  rows.flatMap((row) => (row.kept === undefined ? [] : [row.kept]));

/** Whether two lists of Macros are the same, in the same order. */
export const sameMacros = (a: readonly Macro[], b: readonly Macro[]) => keyOf(a) === keyOf(b);

/** Rows for a list as saved, each with itself as its `kept`. */
export const rowsFor = (macros: readonly Macro[]): MacroRow[] =>
  macros.map((macro) => ({ ...macro, id: newRowId(), kept: macro }));

/**
 * The rows brought in line with `macros`, the list as saved, when it isn't
 * what they sent: a save failed and the list is back as it was, Try again
 * sent it once more, or another device changed it. Each Macro goes to the row
 * that sent its name, or else to a row that sent another (a rename put back),
 * in order, so an open row stays open; a row whose Macro changed shows it as
 * saved. A row that sent nothing (being written, or never saved) stays as it
 * is, and so does one whose Macro isn't in the list any more, now unsaved
 * (an addition that failed). A Macro no row has gets a row of its own where it
 * stands (a deletion put back).
 */
export function reconcile(rows: readonly MacroRow[], macros: readonly Macro[]): MacroRow[] {
  const byName = new Map(rows.flatMap((row) => (row.kept ? [[row.kept.name, row] as const] : [])));
  const paired = new Map<MacroRow, Macro>();
  const unpaired: Macro[] = [];
  for (const macro of macros) {
    const row = byName.get(macro.name);
    if (row === undefined) unpaired.push(macro);
    else paired.set(row, macro);
  }
  const spare = rows.filter(
    (row) =>
      row.kept !== undefined && !paired.has(row) && !macros.some((m) => m.name === row.kept?.name),
  );
  const renamed = new Set<Macro>();
  for (const [i, macro] of unpaired.entries()) {
    const row = spare[i];
    if (row !== undefined) {
      paired.set(row, macro);
      renamed.add(macro);
    }
  }
  const out: MacroRow[] = rows.map((row) => {
    const macro = paired.get(row);
    if (macro === undefined) return row.kept === undefined ? row : { ...row, kept: undefined };
    if (row.kept !== undefined && sameMacros([row.kept], [macro])) return row;
    return { ...row, ...macro, kept: macro };
  });
  // A Macro no row took comes back as a row, after the one before it in the list.
  for (const [index, macro] of macros.entries()) {
    if (unpaired.includes(macro) && !renamed.has(macro)) {
      const before = macros[index - 1];
      const at =
        before === undefined ? 0 : out.findIndex((row) => row.kept?.name === before.name) + 1;
      out.splice(at, 0, { ...macro, id: newRowId(), kept: macro });
    }
  }
  return out;
}

let lastId = 0;
/** A new row's ID, unique on the page. */
export const newRowId = () => `macro-${(lastId += 1)}`;

/**
 * What a failed save of `attempted` says, with `kept` (what is stored, and
 * the list is back to): the Macro it was about, and what the list shows now.
 */
export function macrosSaveErrorText(attempted: readonly Macro[], kept: readonly Macro[]): string {
  const added = attempted.filter((macro) => !kept.some((k) => k.name === macro.name));
  const removed = kept.filter((macro) => !attempted.some((a) => a.name === macro.name));
  const [first] = added;
  const [gone] = removed;
  if (added.length === 1 && removed.length === 1 && first && gone) {
    return `Couldn't save ${first.name}, so the row is back to ${gone.name}.`;
  }
  if (added.length === 1 && removed.length === 0 && first) {
    return `Couldn't save ${first.name}. Try again to save it.`;
  }
  if (added.length === 0 && removed.length === 1 && gone) {
    return `Couldn't save deleting ${gone.name}, so it's back in the list.`;
  }
  const changed = attempted.filter((macro) =>
    kept.some((k) => k.name === macro.name && k.definition !== macro.definition),
  );
  if (added.length === 0 && removed.length === 0 && changed.length === 1 && changed[0]) {
    return `Couldn't save the change to ${changed[0].name}, so it's back as it was.`;
  }
  return "Couldn't save the macros, so they're back as they were.";
}
