# The table widget reformats the table it edits

ADR-0004 keeps what the User wrote byte for byte: the editor changes a Card's Markdown only where the User types. Tables are the one exception. The live-preview editor shows a GFM table as an editable grid, and whenever the grid changes a table (a cell's text, a row or column added, removed or moved, an alignment) it writes that whole table back out with its columns padded to the widest cell and its alignment colons kept, so the stored source lines up and reads well in any other Markdown tool. A table typed by hand or imported keeps its text until the grid first changes it, and nothing outside the table is ever rewritten. A `|` typed in a cell is stored as `\|`.

## Considered Options

- **Change only what changed**: a cell's edit rewrites only that cell's text and a new row or column inserts minimal `| … |` text, so ADR-0004 holds without exception; but the stored columns never line up, and tables edited many times read badly as source.

## Consequences

- One cell's edit can rewrite every line of its table, so a diff of a Card's Markdown shows the whole table changed.
- Padding counts characters, so a column holding wide characters or a long Formula doesn't line up exactly in a proportional font.
