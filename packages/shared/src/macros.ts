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
 * group's tokens without its braces (`start` to `stop`), or one token, and
 * where it ends. Null when there is none: the
 * group ends at `}`, or a brace group never closes.
 */
function readArgument(
  tokens: readonly Token[],
  at: number,
): { start: number; stop: number; end: number } | null {
  let i = at;
  while (isSpace(tokens[i]?.text ?? "")) i++;
  const first = tokens[i]?.text;
  if (first === undefined || first === "}") return null;
  if (first !== "{") return { start: i, stop: i + 1, end: i + 1 };
  let depth = 0;
  for (let j = i; j < tokens.length; j++) {
    if (tokens[j]?.text === "{") depth++;
    else if (tokens[j]?.text === "}") depth--;
    if (depth === 0) return { start: i + 1, stop: j, end: j + 1 };
  }
  return null;
}

/**
 * Where a span of an expanded text came from in the text as written: `from`
 * to `to` in the output, from `source.from` to `source.to` in the input.
 * An `exact` piece is copied character for character, so part of it maps to
 * the same part of its source; any other piece is a Macro's expansion (or a
 * space put in beside it), and all of it maps to the whole Macro as written.
 */
export type SourcePiece = {
  from: number;
  to: number;
  source: { from: number; to: number };
  exact: boolean;
};

/** A text, and where each piece of it came from: {@link expandMacrosMapped}'s output. */
export type MappedText = { text: string; pieces: SourcePiece[] };

/** A text mapped to itself, character for character. */
export const unmapped = (text: string, offset = 0): MappedText => ({
  text,
  pieces:
    text === ""
      ? []
      : [
          {
            from: 0,
            to: text.length,
            source: { from: offset, to: offset + text.length },
            exact: true,
          },
        ],
});

/**
 * The range of the text as written that `from` to `to` in `mapped.text` came
 * from: exact pieces map character for character, and a range over any part
 * of a Macro's expansion widens to the whole Macro. Undefined when nothing in
 * the range came from anywhere (an empty range, or one only over inserted
 * spaces).
 */
export function sourceRange(
  mapped: MappedText,
  from: number,
  to: number,
): { from: number; to: number } | undefined {
  let start = Infinity;
  let end = -Infinity;
  for (const piece of mapped.pieces) {
    if (piece.to <= from || piece.from >= to) continue;
    const range = piece.exact
      ? {
          from: piece.source.from + Math.max(from, piece.from) - piece.from,
          to: piece.source.from + Math.min(to, piece.to) - piece.from,
        }
      : piece.source;
    if (range.to <= range.from) continue;
    start = Math.min(start, range.from);
    end = Math.max(end, range.to);
  }
  return end > start ? { from: start, to: end } : undefined;
}

/** Appends `piece` to `pieces`, joining it to the last one when both are exact and run on. */
function pushPiece(pieces: SourcePiece[], piece: SourcePiece): void {
  if (piece.to <= piece.from) return;
  const last = pieces.at(-1);
  if (
    last !== undefined &&
    last.exact &&
    piece.exact &&
    last.to === piece.from &&
    last.source.to === piece.source.from
  ) {
    last.to = piece.to;
    last.source.to = piece.source.to;
    return;
  }
  pieces.push({ ...piece, source: { ...piece.source } });
}

/** Builds a {@link MappedText} out of spans, each with the source it came from. */
export function mappedBuilder() {
  let text = "";
  const pieces: SourcePiece[] = [];
  return {
    /** Appends `span`, all of it from `source` (character for character when `exact`). */
    push(span: string, source: { from: number; to: number }, exact: boolean) {
      pushPiece(pieces, { from: text.length, to: text.length + span.length, source, exact });
      text += span;
    },
    /** Appends `from` to `to` of `mapped`, keeping where each part of it came from. */
    pushSlice(mapped: MappedText, from: number, to: number) {
      for (const piece of mapped.pieces) {
        const start = Math.max(from, piece.from);
        const end = Math.min(to, piece.to);
        if (end <= start) continue;
        const source = piece.exact
          ? {
              from: piece.source.from + start - piece.from,
              to: piece.source.from + end - piece.from,
            }
          : piece.source;
        pushPiece(pieces, {
          from: text.length + start - from,
          to: text.length + end - from,
          source,
          exact: piece.exact,
        });
      }
      text += mapped.text.slice(from, to);
    },
    done: (): MappedText => ({ text, pieces }),
  };
}

/** A token of a Formula, and where in the side it came from (see {@link SourcePiece}). */
type Token = { text: string; from: number; to: number; exact: boolean };

/** A Macro's definition with its arguments put in for `#1`…`#9`, and `#` for `##`. */
function substitute(definition: readonly Token[], args: readonly Token[][]): Token[] {
  const out: Token[] = [];
  for (let i = 0; i < definition.length; i++) {
    const token = definition[i];
    if (token === undefined) continue;
    const next = definition[i + 1]?.text ?? "";
    if (token.text === "#" && next === "#") {
      out.push(token);
      i++;
    } else if (token.text === "#" && /^[1-9]$/.test(next)) {
      out.push(...(args[Number(next) - 1] ?? []));
      i++;
    } else out.push(token);
  }
  return out;
}

/** Tokens joined back into source, with a space where a control word would run into a letter. */
function untokenize(tokens: readonly Token[], into: ReturnType<typeof mappedBuilder>): void {
  let last: Token | undefined;
  for (const token of tokens) {
    if (last !== undefined && isControlWord(last.text) && /^[A-Za-z]/.test(token.text)) {
      into.push(" ", { from: last.to, to: last.to }, false);
    }
    into.push(token.text, { from: token.from, to: token.to }, token.exact);
    last = token;
  }
}

/**
 * One Formula's source, at `offset` in its side, with its Macros expanded, or
 * as written past the expansion limit, into `into`.
 */
function expandFormula(
  source: string,
  offset: number,
  macros: ReadonlyMap<string, Macro>,
  into: ReturnType<typeof mappedBuilder>,
): void {
  const asWritten = () => into.push(source, { from: offset, to: offset + source.length }, true);
  let at = offset;
  let input: Token[] = tokenize(source).map((text) => {
    const token = { text, from: at, to: at + text.length, exact: true };
    at += text.length;
    return token;
  });
  const own = ownNames(input.map((token) => token.text));
  const out: Token[] = [];
  let expansions = 0;
  let changed = false;
  for (let i = 0; i < input.length;) {
    const token = input[i];
    if (token === undefined) break;
    const macro = own.has(token.text) ? undefined : macros.get(token.text);
    if (macro === undefined) {
      out.push(token);
      i++;
      continue;
    }
    const args: Token[][] = [];
    let end = i + 1;
    for (let n = 0; n < macroArity(macro.definition); n++) {
      const arg = readArgument(input, end);
      if (arg === null) break;
      args.push(input.slice(arg.start, arg.stop));
      end = arg.end;
    }
    if (args.length < macroArity(macro.definition)) {
      // A missing argument: the Macro stays as written.
      out.push(token);
      i++;
      continue;
    }
    expansions++;
    if (expansions > MAX_EXPANSIONS) return asWritten();
    changed = true;
    const invoked = input.slice(i, end);
    const span = {
      from: Math.min(...invoked.map((t) => t.from)),
      to: Math.max(...invoked.map((t) => t.to)),
    };
    const definition = tokenize(macro.definition).map((text) => ({ text, ...span, exact: false }));
    input = [...substitute(definition, args), ...input.slice(end)];
    i = 0;
  }
  if (changed) untokenize(out, into);
  else asWritten();
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
 * read it, for the Grader, which has no KaTeX of its own. Text, code
 * and `\$` stay as written. An argument is a brace group (its braces dropped)
 * or a single token; a Macro missing one stays as written. Macros inside
 * Macros expand too, up to 1,000 expansions per Formula, past which that
 * Formula stays as written. A Formula's own `\def` / `\newcommand` names are
 * left alone inside it.
 */
export const expandMacros = (side: string, macros: readonly Macro[]): string =>
  expandMacrosMapped(side, macros).text;

/**
 * {@link expandMacros}' output, and where each piece of it came from in
 * `side`, so a range of the expanded text can be mapped back to the side as
 * written ({@link sourceRange}). An argument's tokens map to themselves; the
 * rest of a Macro's expansion maps to the whole Macro, arguments and all.
 */
export function expandMacrosMapped(side: string, macros: readonly Macro[]): MappedText {
  if (macros.length === 0) return unmapped(side);
  const byName = new Map(macros.map((macro) => [macro.name, macro]));
  const out = mappedBuilder();
  let pos = 0;
  for (const { from, to } of formulaRanges(side)) {
    out.push(side.slice(pos, from), { from: pos, to: from }, true);
    expandFormula(side.slice(from, to), from, byName, out);
    pos = to;
  }
  out.push(side.slice(pos), { from: pos, to: side.length }, true);
  return out.done();
}
