# An Import is read on the server and waits unconfirmed for its preview

The browser sends the Card file as it is, a `.json`, a `.zip` with its Images, or pasted text, and the API reads it: it unpacks the zip, runs `parseCardFile`, finds Duplicates and image problems, and plans which Macros the Deck gains. What it read is kept as an Import that isn't confirmed yet, with its Images in a staging area, and the preview and later the report are that Import's own page. The User's ticks and edits stay in the browser and go with the confirm request, which the API checks again against the Deck as it is then. An Import never confirmed is removed with its staged files 24 hours after it was made, by the same hourly sweep as unreferenced Images.

So there is one reader of Card files, on the server, a preview survives a refresh, and an Import is one record from upload to report, which the import history and its undo (BAN-33) build on.

## Considered Options

- **The browser reads the file and the API only commits**: nothing reaches the server before the User confirms, and the preview shows the zip's Images from local blobs. But the zip and the parser's rules would run in two places, a refresh loses the preview, and the commit would upload every Image one by one before posting the Cards.
- **A staged upload of its own**, separate from the Import: an Import would only ever mean a confirmed one, at the cost of a second record, a second cleanup, and a preview with no lasting address.

## Consequences

- Every preview uploads the whole file, Images included, up to 500 MB, and the API must refuse a larger body, and a zip that unpacks to more, before reading it.
- An Import has two states, and everything that lists Imports (BAN-33's history) shows only confirmed ones.
- Edits made in the preview are lost on a refresh; the page asks before the User leaves with changes.
