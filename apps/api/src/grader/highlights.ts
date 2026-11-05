import { type MappedText, sourceRange, type TextRange } from "@banki/shared";

/** A Highlight as the Grader answers it: a line of the text it was sent (from 1), and a quote on it. */
export type QuotedHighlight = { line: number; quote: string };

/** The ranges of `text`'s lines, without their line breaks, the first line first. */
function lineRanges(text: string): TextRange[] {
  const ranges: TextRange[] = [];
  let from = 0;
  for (;;) {
    const newline = text.indexOf("\n", from);
    const to = newline === -1 ? text.length : newline;
    ranges.push({ from, to });
    if (newline === -1) return ranges;
    from = newline + 1;
  }
}

/** `from` to `to` in `text`, without the whitespace at either end. */
function trimmed(text: string, { from, to }: TextRange): TextRange {
  let start = from;
  let end = to;
  while (start < end && /\s/.test(text[start] ?? "")) start++;
  while (end > start && /\s/.test(text[end - 1] ?? "")) end--;
  return { from: start, to: end };
}

/**
 * The range of the stored text that a Highlight points at, given `sent`, the
 * text the Grader was sent and where each piece of it came from in the
 * stored text. The quote on its line maps to its own range, widened to the
 * whole of any Macro or Image it covers part of; a quote that isn't on its
 * line maps to the whole line; a line that isn't there, or holds nothing,
 * maps to nothing, and the Highlight is dropped.
 */
export function highlightRange(
  sent: MappedText,
  { line, quote }: QuotedHighlight,
): TextRange | undefined {
  const lines = lineRanges(sent.text);
  const whole = Number.isInteger(line) ? lines[line - 1] : undefined;
  if (whole === undefined) return undefined;
  const text = sent.text.slice(whole.from, whole.to);
  const needle = quote.trim();
  const at = needle === "" ? -1 : text.indexOf(needle);
  const range =
    at === -1
      ? trimmed(sent.text, whole)
      : { from: whole.from + at, to: whole.from + at + needle.length };
  if (range.to <= range.from) return undefined;
  return sourceRange(sent, range.from, range.to);
}
