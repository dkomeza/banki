// A reply as it streams in arrives cut anywhere, often inside a Formula: shown
// as it is, `$$\int_0^x \frac{d` would flash as raw LaTeX until its closing
// `$$` came. So a streaming reply shows up to the Formula still open.

/**
 * `text` without its last Formula when that one isn't closed yet: from an
 * unclosed `$$`, or else an unclosed `$`, to the end. An escaped `\$` is no
 * delimiter.
 */
export function closedFormulas(text: string): string {
  let open: { at: number; display: boolean } | undefined;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === "\\") {
      i += 1;
      continue;
    }
    if (char !== "$") continue;
    const display = text[i + 1] === "$";
    if (open === undefined) open = { at: i, display };
    else if (open.display === display) open = undefined;
    // A lone `$` inside a display Formula is its own text.
    else if (!open.display) open = undefined;
    if (display) i += 1;
  }
  return open === undefined ? text : text.slice(0, open.at).trimEnd();
}
