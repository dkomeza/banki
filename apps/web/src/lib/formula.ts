import { ParseError, renderToString } from "katex";
// Registers mhchem's \ce and \pu with KaTeX.
// oxlint-disable-next-line import/no-unassigned-import
import "katex/contrib/mhchem";

// Typesets a Formula with KaTeX: HTML for the eye plus hidden MathML for
// screen readers (and for copy-tex, which copies a Formula's source from it).
// `trust` is off, so \href, \url, \includegraphics, \htmlClass and the like
// don't run; each Formula gets macros of its own, so a \def or \newcommand
// stays inside it; KaTeX's expansion limit stops a runaway macro. Display
// Formulas are left-aligned (`fleqn`).

/** A typeset Formula's HTML, or the message of why it couldn't be typeset. */
export type Typeset = { html: string } | { error: string };

/** How many typeset Formulas are kept, so a long list of Cards typesets each one once. */
const CACHE_SIZE = 1000;
const cache = new Map<string, Typeset>();

/** Typesets `source` (without its delimiters), as display math or inline. */
export function typeset(source: string, display: boolean): Typeset {
  const key = `${display ? "$$" : "$"}${source}`;
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
        macros: {},
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
