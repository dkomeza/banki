# a: Ledger

One card of rows, newest first: each Deletion on a line with its kind, where it was, what went with it and its days left, and Restore and Delete permanently always beside it; reached from its own "Recently deleted" nav item (a third tab, "Deleted", below 1024 px).

States: empty, restored, restored-root, restored-renamed, refused, delete (on `/deleted`); undo (on `/`)

Prototype only: the list is the spec's Seed Deletions held in the page (no API yet), so Restore and Delete permanently last until a reload. A refused Restore is an error toast.
