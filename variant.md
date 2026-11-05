# c: Timeline

The deck page's own timeline: the file's Cards hang on a rail in file order, each a bordered card with its Front and Back rendered, and the dot on the rail is its tick (a lock on a Duplicate, which hangs dashed); Macros and image problems open the page as "Before you import", invalid Cards close the rail, Edit opens the editor in a dialog, and a paper dock floats with the count and Import. The source is one box to paste into or drop a file on, every page names the step (Source, Preview, Report), and the report is the Import's own timeline of what happened.

States: paste, refused, uploading (on `/decks/$deckId/import`); preview, edit, many, confirming, report-clean (on `/imports/$importId`; its plain load is the seeded report).
