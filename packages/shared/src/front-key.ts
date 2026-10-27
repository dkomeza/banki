import { deckNameKey } from "./decks";

// Pieces of a Front that the Markdown and case steps must leave alone (math,
// escaped marks, images) are set aside in a stash and stand in the text as a
// placeholder of private-use characters around their index, put back at the end.
const OPEN = "";
const CLOSE = "";
const PLACEHOLDER = /(\d+)/g;

/** ASCII punctuation, the characters a backslash escapes in Markdown. */
const ESCAPABLE = /[!-/:-@[-`{-~]/;

const WHITESPACE = /\s/;

/**
 * Where the `$…$` math opening at `start` closes, or -1 when it doesn't. As in
 * Pandoc, the opening `$` has something other than whitespace right after it,
 * and the closing one has it right before and no digit after, so "$5 and $10"
 * holds no math.
 */
function inlineMathEnd(text: string, start: number): number {
  const first = text[start + 1];
  if (first === undefined || first === "$" || WHITESPACE.test(first)) return -1;
  for (let i = start + 1; i < text.length; i++) {
    const char = text[i];
    if (char === "\\") {
      i++;
      continue;
    }
    if (char !== "$") continue;
    const before = text[i - 1] ?? "";
    const after = text[i + 1] ?? "";
    if (!WHITESPACE.test(before) && !/[0-9]/.test(after)) return i;
  }
  return -1;
}

/**
 * Sets aside the math spans and the escaped marks, leaving the rest as it is.
 * A math span keeps its content without its delimiters or any whitespace; an
 * escaped mark becomes the mark itself. The placeholder characters themselves,
 * when typed, are set aside too, so they never read as a placeholder.
 */
function stashMathAndEscapes(text: string, stash: string[]): string {
  const put = (piece: string) => `${OPEN}${stash.push(piece) - 1}${CLOSE}`;
  const math = (content: string) => put(content.replace(/\s+/g, ""));
  let out = "";
  let i = 0;
  while (i < text.length) {
    const char = text.charAt(i);
    const next = text[i + 1];
    if (char === OPEN || char === CLOSE) {
      out += put(char);
      i++;
      continue;
    }
    if (char === "\\" && (next === "(" || next === "[")) {
      const end = text.indexOf(next === "(" ? "\\)" : "\\]", i + 2);
      if (end !== -1) {
        out += math(text.slice(i + 2, end));
        i = end + 2;
        continue;
      }
    }
    if (char === "\\" && next !== undefined && ESCAPABLE.test(next)) {
      out += put(next);
      i += 2;
      continue;
    }
    if (char === "$" && next === "$") {
      const end = text.indexOf("$$", i + 2);
      if (end !== -1) {
        out += math(text.slice(i + 2, end));
        i = end + 2;
        continue;
      }
      out += "$$";
      i += 2;
      continue;
    }
    if (char === "$") {
      const end = inlineMathEnd(text, i);
      if (end !== -1) {
        out += math(text.slice(i + 1, end));
        i = end + 1;
        continue;
      }
    }
    out += char;
    i++;
  }
  return out;
}

/** Puts the stashed pieces back in place of their placeholders. */
const unstash = (text: string, stash: readonly string[]) =>
  text.replace(PLACEHOLDER, (placeholder, index: string) => stash[Number(index)] ?? placeholder);

/** A line's leading quote, heading and list markers, any number of them nested. */
const LINE_MARKERS = /^[ \t]*(?:(?:>|#{1,6}(?=\s|$)|[-*+](?=\s)|[0-9]+\.(?=\s))[ \t]*)+/gm;

/**
 * A link's destination in parentheses: its URL, which may hold balanced
 * parentheses one deep, and an optional "title", spaces allowed around them.
 */
const DESTINATION = String.raw`\(\s*(?:[^()\s]|\([^()\s]*\))*(?:\s+"[^"]*")?\s*\)`;

/** `![alt](url)` or `[text](url)`. */
const IMAGE = new RegExp(String.raw`!\[[^\]]*\]` + DESTINATION, "g");
const LINK = new RegExp(String.raw`\[([^\]]*)\]` + DESTINATION, "g");

/**
 * The key two Fronts are compared by: two Cards are Duplicates when their
 * Fronts' keys are equal and not empty. Applied in order: Unicode NFC; math
 * (`$…$`, `$$…$$`, `\(…\)`, `\[…\]`) keeps its content as written, minus its
 * whitespace, and drops its delimiters; outside math, Markdown's emphasis,
 * strike and code marks, line-start heading, quote and list markers, and link
 * syntax (keeping the link's text) are dropped, a backslash-escaped mark
 * counting as the mark itself and an image kept as written, URL and all;
 * every run of whitespace becomes one space, the ends trimmed; and case is
 * folded outside math as {@link deckNameKey} folds it, accents kept. Math
 * keeps its case: what is inside it counts as written (`CONTEXT.md`).
 */
export function frontKey(front: string): string {
  const stash: string[] = [];
  let text = stashMathAndEscapes(front.normalize("NFC"), stash);
  text = text.replace(
    IMAGE,
    (image) => `${OPEN}${stash.push(unstash(deckNameKey(image), stash)) - 1}${CLOSE}`,
  );
  text = text
    .replace(LINE_MARKERS, "")
    .replace(LINK, "$1")
    .replace(/[*_~`]/g, "");
  text = unstash(deckNameKey(text), stash);
  return text.replace(/\s+/g, " ").trim();
}
