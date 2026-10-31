import { z } from "zod";
import { CardFileMacro } from "./card-file";
import { type CardNode, cardParser } from "./card-parser";

// Macros: short names for LaTeX the User writes often. Settings hold a list
// for every Deck, and a Deck may have its own list on top. Both are stored as
// the Card file's macro is: a name and a definition, in KaTeX's syntax with
// #1 to #9 for arguments. The API checks only the rules below; it has no
// KaTeX, so whether a definition typesets is the browser's to say.

/** The most Macros in one list: Settings', or one Deck's own. */
export const MACROS_MAX = 100;

/** The longest a Macro's definition may be. */
export const MACRO_DEFINITION_MAX_LENGTH = 1_000;

/** One Macro: its name (`\R`), and what it stands for (`\mathbb{R}`). */
export const Macro = CardFileMacro;
export type Macro = CardFileMacro;

/** A list of Macros, Settings' or a Deck's own: up to 100, no name twice, each definition up to 1,000 characters. */
export const MacroList = z
  .array(Macro)
  .max(MACROS_MAX, `Keep to ${MACROS_MAX} macros`)
  .superRefine((macros, ctx) => {
    const seen = new Set<string>();
    for (const [index, { name, definition }] of macros.entries()) {
      if (definition.length > MACRO_DEFINITION_MAX_LENGTH) {
        ctx.addIssue({
          code: "custom",
          message: `Keep ${name}'s definition to ${MACRO_DEFINITION_MAX_LENGTH.toLocaleString("en-GB")} characters`,
          path: [index, "definition"],
        });
      }
      if (seen.has(name)) {
        ctx.addIssue({
          code: "custom",
          message: `${name} is in the list twice`,
          path: [index, "name"],
        });
      }
      seen.add(name);
    }
  });
export type MacroList = z.infer<typeof MacroList>;

/**
 * How many arguments a Macro with `definition` takes, as KaTeX counts them:
 * `#1`, `#2`, … up to the first one missing (`##` is a `#`). KaTeX
 * can't typeset a definition with a gap, such as `#1#3`.
 */
export function macroArity(definition: string): number {
  const stripped = definition.replaceAll("##", "");
  let arity = 0;
  while (arity < 9 && stripped.includes(`#${arity + 1}`)) arity++;
  return arity;
}

/**
 * A Deck's effective Macros: Settings' with the Deck's own on top, per name.
 * A Deck's Macro takes the place of Settings' of its name; its others follow.
 */
export function effectiveMacros(settings: readonly Macro[], deck: readonly Macro[]): Macro[] {
  const own = new Map(deck.map((macro) => [macro.name, macro]));
  const merged = settings.map((macro) => own.get(macro.name) ?? macro);
  const inSettings = new Set(settings.map((macro) => macro.name));
  return [...merged, ...deck.filter((macro) => !inSettings.has(macro.name))];
}

/** How many Macro expansions one Formula may take, as KaTeX's `maxExpand`. */
const MAX_EXPANSIONS = 1000;

/** The commands that define a name inside a Formula, whose names stay the Formula's own. */
const DEFINERS = new Set([
  "\\def",
  "\\gdef",
  "\\edef",
  "\\xdef",
  "\\let",
  "\\newcommand",
  "\\renewcommand",
  "\\providecommand",
]);

/**
 * TeX's tokens of `source`: a control word (`\` and letters), a control
 * symbol (`\` and one other character), a comment (`%` to the line's end), or
 * one character.
 */
function tokenize(source: string): string[] {
  const tokens: string[] = [];
  for (let i = 0; i < source.length;) {
    const char = source[i] ?? "";
    let end = i + 1;
    if (char === "\\") {
      end = i + 2;
      if (/[A-Za-z]/.test(source[i + 1] ?? "")) {
        while (/[A-Za-z]/.test(source[end] ?? "")) end++;
      }
      end = Math.min(end, source.length);
    } else if (char === "%") {
      const newline = source.indexOf("\n", i);
      end = newline === -1 ? source.length : newline;
    }
    // A character outside the Basic Multilingual Plane is two code units, after a `\` too.
    const last = source.charCodeAt(end - 1);
    if (last >= 0xd800 && last <= 0xdbff && end < source.length) end++;
    tokens.push(source.slice(i, end));
    i = end;
  }
  return tokens;
}

const isControlWord = (token: string) => /^\\[A-Za-z]+$/.test(token);
const isSpace = (token: string) => /^\s$/.test(token);

/** The names a Formula's own `\def`, `\newcommand` and the like define. */
function ownNames(tokens: readonly string[]): Set<string> {
  const names = new Set<string>();
  for (let i = 0; i < tokens.length; i++) {
    if (!DEFINERS.has(tokens[i] ?? "")) continue;
    let j = i + 1;
    // `\newcommand*` is `\newcommand` for an argument with no paragraph break.
    if (tokens[j] === "*") j++;
    while (isSpace(tokens[j] ?? "")) j++;
    if (tokens[j] === "{") j++;
    const name = tokens[j] ?? "";
    if (name.startsWith("\\")) names.add(name);
  }
  return names;
}

/**
 * The argument starting at `at` in `tokens` (after any spaces): a brace
 * group's tokens without its braces, or one token. Null when there is none: the
 * group ends at `}`, or a brace group never closes.
 */
function readArgument(
  tokens: readonly string[],
  at: number,
): { tokens: string[]; end: number } | null {
  let i = at;
  while (isSpace(tokens[i] ?? "")) i++;
  const first = tokens[i];
  if (first === undefined || first === "}") return null;
  if (first !== "{") return { tokens: [first], end: i + 1 };
  let depth = 0;
  for (let j = i; j < tokens.length; j++) {
    if (tokens[j] === "{") depth++;
    else if (tokens[j] === "}") depth--;
    if (depth === 0) return { tokens: tokens.slice(i + 1, j), end: j + 1 };
  }
  return null;
}

/** A Macro's definition with its arguments put in for `#1`…`#9`, and `#` for `##`. */
function substitute(definition: readonly string[], args: readonly string[][]): string[] {
  const out: string[] = [];
  for (let i = 0; i < definition.length; i++) {
    const token = definition[i] ?? "";
    const next = definition[i + 1] ?? "";
    if (token === "#" && next === "#") {
      out.push("#");
      i++;
    } else if (token === "#" && /^[1-9]$/.test(next)) {
      out.push(...(args[Number(next) - 1] ?? []));
      i++;
    } else out.push(token);
  }
  return out;
}

/** Tokens joined back into source, with a space where a control word would run into a letter. */
function untokenize(tokens: readonly string[]): string {
  let out = "";
  let last = "";
  for (const token of tokens) {
    if (isControlWord(last) && /^[A-Za-z]/.test(token)) out += " ";
    out += token;
    last = token;
  }
  return out;
}

/** One Formula's source with its Macros expanded, or as written past the expansion limit. */
function expandFormula(source: string, macros: ReadonlyMap<string, Macro>): string {
  let input = tokenize(source);
  const own = ownNames(input);
  const out: string[] = [];
  let expansions = 0;
  let changed = false;
  for (let i = 0; i < input.length;) {
    const token = input[i] ?? "";
    const macro = own.has(token) ? undefined : macros.get(token);
    if (macro === undefined) {
      out.push(token);
      i++;
      continue;
    }
    const args: string[][] = [];
    let end = i + 1;
    for (let n = 0; n < macroArity(macro.definition); n++) {
      const arg = readArgument(input, end);
      if (arg === null) break;
      args.push(arg.tokens);
      end = arg.end;
    }
    if (args.length < macroArity(macro.definition)) {
      // A missing argument: the Macro stays as written.
      out.push(token);
      i++;
      continue;
    }
    expansions++;
    if (expansions > MAX_EXPANSIONS) return source;
    changed = true;
    input = [...substitute(tokenize(macro.definition), args), ...input.slice(end)];
    i = 0;
  }
  return changed ? untokenize(out) : source;
}

/** The ranges of `side` that are Formulas' sources, between their delimiters. */
function formulaRanges(side: string): { from: number; to: number }[] {
  const ranges: { from: number; to: number }[] = [];
  cardParser.parse(side).iterate({
    enter: (node) => {
      if (
        node.name !== "InlineFormula" &&
        node.name !== "DisplayFormula" &&
        node.name !== "DisplayFormulaBlock"
      ) {
        return undefined;
      }
      const marks: CardNode[] = node.node.getChildren("FormulaMark");
      const from = marks[0]?.to ?? node.from;
      const to = marks[1]?.from ?? node.to;
      if (to > from) ranges.push({ from, to });
      return false;
    },
  });
  return ranges;
}

/**
 * A Card side with each Macro replaced inside its Formulas, as KaTeX would
 * read it, for the Grader (BAN-39), which has no KaTeX of its own. Text, code
 * and `\$` stay as written. An argument is a brace group (its braces dropped)
 * or a single token; a Macro missing one stays as written. Macros inside
 * Macros expand too, up to 1,000 expansions per Formula, past which that
 * Formula stays as written. A Formula's own `\def` / `\newcommand` names are
 * left alone inside it.
 */
export function expandMacros(side: string, macros: readonly Macro[]): string {
  if (macros.length === 0) return side;
  const byName = new Map(macros.map((macro) => [macro.name, macro]));
  let out = "";
  let pos = 0;
  for (const { from, to } of formulaRanges(side)) {
    out += side.slice(pos, from) + expandFormula(side.slice(from, to), byName);
    pos = to;
  }
  return out + side.slice(pos);
}
