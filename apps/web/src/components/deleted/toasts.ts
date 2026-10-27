import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { type Restored, restoreDeletion, restoredToast } from "@/lib/deletions";

/** How long "… deleted" stays up; hovering or focusing it keeps it open. */
export const UNDO_MS = 8000;

/**
 * "Maths restored", "Calculus 2 restored to Decks" or "Restored as Spanish
 * vocabulary (2)", with where it is now. `was` is its name before, `where`
 * where it was.
 */
export function showRestoredToast(restored: Restored, was: string, where: string) {
  const { title, description } = restoredToast(restored, was, where);
  toast(title, { id: `restored-${restored.id}`, description });
}

/**
 * Shows "Calculus 2 deleted" or "Maths deleted" after a Deck's or Folder's
 * delete, with Undo for about 8 seconds, when there is a Deletion to undo.
 * The toaster lives in the shell, so the toast outlasts the page it was shown
 * from. Undo restores the Deletion by Restore's rules, and says where it came
 * back, or why it couldn't. `where` is where it was: "Decks › Maths".
 */
export function showDeletedToast(
  queryClient: QueryClient,
  { name, deletionId, where }: { name: string; deletionId: string | undefined; where: string },
) {
  toast(`${name} deleted`, {
    id: `deleted-${deletionId ?? name}`,
    description: "It waits in Recently deleted for 30 days.",
    duration: UNDO_MS,
    ...(deletionId === undefined
      ? {}
      : {
          action: {
            label: "Undo",
            onClick: () => {
              void restoreDeletion(queryClient, deletionId).then((outcome) => {
                if (outcome.ok) showRestoredToast(outcome.restored, name, where);
                else if ("message" in outcome) toast.error(outcome.message);
                else toast.error(`Restore ${outcome.placeDeleted.name} first.`);
              });
            },
          },
        }),
  });
}
