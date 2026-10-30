import {
  effectiveMacros,
  type Macro,
  MACRO_DEFINITION_MAX_LENGTH,
  macroArity,
  MACROS_MAX,
} from "@banki/shared";
import { useQuery } from "@tanstack/react-query";
import { createContext, useContext, useMemo } from "react";
import { deckQueryOptions } from "./decks";
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
 * and follow it as they are saved.
 */
export function useEffectiveMacros(own: readonly Macro[] | undefined): readonly Macro[] {
  const settings = useQuery(settingsQueryOptions()).data?.settings.macros ?? NO_MACROS;
  const mine = own ?? NO_MACROS;
  const key = `${keyOf(settings)}${keyOf(mine)}`;
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => effectiveMacros(settings, mine), [key]);
}

/** The effective Macros of the Deck `deckId`, as its Cards render with them. */
export function useDeckMacros(deckId: string): readonly Macro[] {
  return useEffectiveMacros(useQuery(deckQueryOptions(deckId)).data?.macros);
}

// Writing a Macro -------------------------------------------------------------

/** A Macro as it is being written, in its list: maybe not valid, and so not saved, yet. */
export type MacroRow = Macro & { id: string };

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
  } else if (row.name !== "\\" && rows.findIndex((other) => other.name === row.name) !== index) {
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

/** The Macros of `rows` that are saved: those written, with no problem. */
export function savedMacros(rows: readonly MacroRow[], under: readonly Macro[]): Macro[] {
  return rows
    .filter((row) => checkRow(row, rows, under).saved)
    .map(({ name, definition }) => ({ name, definition }));
}

/** Whether two lists of Macros are the same, in the same order. */
export const sameMacros = (a: readonly Macro[], b: readonly Macro[]) => keyOf(a) === keyOf(b);

/**
 * A list's rows for `macros`, keeping the ID (and so the open row) of each
 * row in `rows` whose name is still there.
 */
export function rowsFor(macros: readonly Macro[], rows: readonly MacroRow[] = []): MacroRow[] {
  const ids = new Map(rows.map((row) => [row.name, row.id]));
  return macros.map((macro) => ({ ...macro, id: ids.get(macro.name) ?? newRowId() }));
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
    return `Couldn't save ${first.name}, so it isn't in the list.`;
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
