// Prototype only (BAN-13): the toasts Recently deleted and a Deck or Folder
// delete show, in BAN-12's Sonner look, each with a second line saying where
// things are now (Variant b). Undo and Restore don't reach the API yet: they
// show what the API will answer.
import { toast } from "sonner";
import { type Deletion, restoredMessage, whereLabel } from "@/lib/deletions-proto";

/** How long "… deleted" stays up; hovering or focusing it keeps it open. */
const UNDO_MS = 8000;

/** "Calculus 2 deleted", with Undo. `persist` keeps it up, for a `?state=` link. */
export function showDeletedToast(name: string, persist = false) {
  toast(`${name} deleted`, {
    id: `deleted-${name}`,
    description: "It waits in Recently deleted for 30 days.",
    duration: persist ? Number.POSITIVE_INFINITY : UNDO_MS,
    action: { label: "Undo", onClick: () => toast(`${name} restored`) },
  });
}

/** Where a restored Deletion is now, in a second line. */
function whereNow(d: Deletion): string {
  const r = d.restore;
  if (r.kind === "root") return "Its folder is deleted, so it's back at the top of Decks.";
  if (r.kind === "renamed")
    return `${whereLabel(d)} already has a ${d.top.kind} called ${d.top.name}.`;
  return `Back in ${whereLabel(d)}.`;
}

/** "Physics restored", "… restored to Decks" or "Restored as …", with where it is now. */
export function showRestoredToast(d: Deletion) {
  toast(restoredMessage(d), { id: `restore-${d.id}`, description: whereNow(d) });
}
