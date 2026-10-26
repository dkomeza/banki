// Prototype only (BAN-13): the toasts Recently deleted and a Deck or Folder
// delete show, in BAN-12's Sonner look. Undo and Restore don't reach the API
// yet: they show what the API will answer.
import { toast } from "sonner";
import { type Deletion, restoredMessage } from "@/lib/deletions-proto";

/** How long "… deleted" stays up; hovering or focusing it keeps it open. */
const UNDO_MS = 8000;

/** "Calculus 2 deleted", with Undo. `persist` keeps it up, for a `?state=` link. */
export function showDeletedToast(name: string, persist = false) {
  toast(`${name} deleted`, {
    id: `deleted-${name}`,
    duration: persist ? Number.POSITIVE_INFINITY : UNDO_MS,
    action: { label: "Undo", onClick: () => toast(`${name} restored`) },
  });
}

/** "Physics restored", "… restored to Decks", "Restored as …", or "Restore <Deck> first". */
export function showRestoredToast(d: Deletion) {
  const message = restoredMessage(d);
  if (d.restore.kind === "refused") toast.error(message, { id: `restore-${d.id}` });
  else toast(message, { id: `restore-${d.id}` });
}
