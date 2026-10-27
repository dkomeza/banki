# Cards refer to Images by a relative path, and an Image lives while a Card refers to it

A Card shows an Image through plain Markdown, `![](images/<id>.<ext>)`: a relative path with no origin and no API route in it. Whatever shows a Card (the editor's thumbnails now, the Markdown renderer from M3) resolves `images/…` to the API's endpoint that serves the Image. So the stored Markdown never names the API's origin (ADR-0002 keeps a later split across origins open), and a deck exported as a zip with an `images/` folder beside its JSON (BAN-34) reads correctly as it is in other Markdown tools.

An Image has no owner. It is kept while any Card that isn't Removed refers to it, deleted or not, and the hourly sweep that runs Removals deletes an Image no Card refers to once it is 24 hours old. One rule covers an upload never saved into a Card, a reference an edit dropped, a reference copied into a second Card, and a Card's Removal: nothing is deleted while something could still show it, and the 24 hours give an unsaved New card page time to be saved.

## Considered Options

- **`/api/images/<id>`, an absolute path to the endpoint**: works as an `<img src>` with no resolving, but bakes the API's route and its single origin into the User's data, and export would rewrite every reference.
- **A custom scheme, `banki-image:<id>`**: never mistaken for a URL, but meaningless in any other tool, and export would rewrite it too.
- **Each Image owned by the Card it was first saved into**, deleted at that Card's Removal: no reference scanning, but a reference copied into another Card breaks once the owner is Removed, and an Image an edit dropped stays until then.

## Consequences

- Changing the reference form later means a migration over every Card's Markdown.
- Whatever decides whether an Image is referred to reads every Card's Front and Back that isn't Removed, which is fine at a single User's scale.
- Restoring a Deletion never finds its Images gone: a deleted Card still refers to them.
