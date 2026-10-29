# a: On the rules

Bet: an Image sits on the page like a pasted-in print, left-aligned and at most eight lines tall, and everything transient about it (uploading, an error) is one ruled line of text, so the side never jumps while files go up.

- Picture: its own size up to the side's width and 16 rem tall, a hairline border; "Open full size" is a pill on its top-right corner on hover or focus (always on touch).
- Uploading: a muted line, "⟳ Uploading **name**", in place of the line the reference will take.
- Error: the same line in red, "⚠ **name** message ×".
- Missing: a dashed tile the shape of a small print, "Missing image" and the file name.
- Drop cursor: an accent rule between lines, tagged "Drop to add here" at its end.
- Toolbar: the Image button ends the pill after a separator; on a phone it is pinned at the ink bar's end while the other tools scroll.
- Table cell: a small framed thumbnail, 3 rem tall.

States: picture, source, uploading, failed, missing, dragging, table, toolbar
