# b: Shelf

Tiles grouped by when they were deleted (Today, Yesterday, This week, Earlier), each with a faded picture of what went and a bar that empties over its 30 days; a refused Restore explains itself inside the tile and points at the Deck to restore first; toasts carry a second line saying where things are now; reached from a quiet "Recently deleted · 9 waiting" row at the foot of Home, with no nav item.

States: empty, restored, restored-root, restored-renamed, refused, delete (on `/deleted`); undo (on `/`)

Prototype only: the list is the spec's Seed Deletions held in the page (no API yet), so Restore and Delete permanently last until a reload, and Home's count is fixed.
