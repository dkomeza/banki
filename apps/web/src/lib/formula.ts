import type { Macro } from "@banki/shared";
import { ParseError, renderToString } from "katex";
// Registers mhchem's \ce and \pu with KaTeX.
// oxlint-disable-next-line import/no-unassigned-import
import "katex/contrib/mhchem";

// Typesets a Formula with KaTeX: HTML for the eye plus hidden MathML for
// screen readers (and for copy-tex, which copies a Formula's source from it).
// `trust` is off, so \href, \url, \includegraphics, \htmlClass and the like
// don't run; each Formula gets a fresh copy of its Deck's Macros, so a \def
// or \newcommand stays inside it, and wins over a Macro of its name there;
// KaTeX's expansion limit stops a runaway macro. Display Formulas are
// left-aligned (`fleqn`).

/** A typeset Formula's HTML, or the message of why it couldn't be typeset. */
export type Typeset = { html: string } | { error: string };

/** No Macros: what a Formula is typeset with outside a Deck. */
export const NO_MACROS: readonly Macro[] = [];

/** How many typeset Formulas are kept, so a long list of Cards typesets each one once. */
const CACHE_SIZE = 1000;
const cache = new Map<string, Typeset>();

/** Each list of Macros as part of a cache key, worked out once per list. */
const macroKeys = new WeakMap<readonly Macro[], string>();
function keyOf(macros: readonly Macro[]): string {
  let key = macroKeys.get(macros);
  if (key === undefined) {
    key = macros.length === 0 ? "" : JSON.stringify(macros.map((m) => [m.name, m.definition]));
    macroKeys.set(macros, key);
  }
  return key;
}

/**
 * Typesets `source` (without its delimiters), as display math or inline,
 * with `macros`: a Deck's effective Macros. The cache is keyed by them too,
 * so a changed Macro typesets again every Formula that uses it.
 */
export function typeset(
  source: string,
  display: boolean,
  macros: readonly Macro[] = NO_MACROS,
): Typeset {
  // JSON escapes every newline, so the first one ends the Macros' part.
  const key = `${display ? "$$" : "$"}${keyOf(macros)}\n${source}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  let result: Typeset;
  try {
    result = {
      html: renderToString(source, {
        displayMode: display,
        fleqn: true,
        output: "htmlAndMathml",
        throwOnError: true,
        trust: false,
        strict: "ignore",
        maxExpand: 1000,
        macros: Object.fromEntries(macros.map((macro) => [macro.name, macro.definition])),
      }),
    };
  } catch (error) {
    result = {
      error: error instanceof ParseError ? error.rawMessage : "This formula can't be shown.",
    };
  }
  if (cache.size >= CACHE_SIZE) cache.delete(cache.keys().next().value ?? "");
  cache.set(key, result);
  return result;
}

const known = new Map<string, boolean>();

/**
 * Whether KaTeX knows the command `name` (`\R`, `\frac`) on its own, so a
 * Macro of that name replaces it: typeset alone, it is anything but an
 * undefined control sequence.
 */
export function knownToKatex(name: string): boolean {
  let found = known.get(name);
  if (found === undefined) {
    try {
      renderToString(name, { throwOnError: true, strict: "ignore", trust: false });
      found = true;
    } catch (error) {
      found = !(
        error instanceof ParseError && error.rawMessage.startsWith("Undefined control sequence")
      );
    }
    known.set(name, found);
  }
  return found;
}
