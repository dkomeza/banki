# One Lezer parser reads Cards, in the editor and on display

A Card's Markdown with LaTeX is read by one parser everywhere: `@lezer/markdown`, the parser CodeMirror's Markdown mode is built on (ADR-0004), with GFM tables and strikethrough and a Formula extension of our own. The live-preview editor decorates its tree, and the read-only display (the deck page's timeline, Card names, and later the study screen) renders the same tree to React with KaTeX. So what counts as a Formula, an escaped `\$`, or a line break is decided in one place, and a Formula that renders in the editor can't stay source text on the timeline, or the other way round. The rules are Banki's own: Pandoc's `$` rules (a `$` opens only before a non-space and closes only after a non-space, not before a digit, so "$5 and $10" stays text), `$$…$$` display math anywhere and across lines, and every newline a line break, as Obsidian does by default. The parser lives in `@banki/shared`, with no DOM, so the API can find Formulas too (BAN-22 expands macros before a Card goes to the Grader).

## Considered Options

- **unified (remark-math, rehype-katex, remark-breaks)**: mature and well tested, but micromark's math treats any two `$` as a Formula, so Pandoc's rules would need a custom extension anyway, and the editor's Lezer tree would disagree with it on edge cases.
- **markdown-it with a custom `$` rule**: small and fast, but still a second parser the editor would have to match by hand.

## Consequences

- We write and maintain the tree-to-React renderer ourselves (paragraphs, emphasis, lists, code, tables, links, images, Formulas), and it never renders raw HTML: HTML in a Card shows as text.
- Changing a Formula rule means changing one extension, and both the editor and the display follow.
