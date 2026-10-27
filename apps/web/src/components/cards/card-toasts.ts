import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { UNDO_MS } from "@/components/deleted/toasts";
import { type Card, deleteCard, forgetCard } from "@/lib/cards";
import { restoreDeletion } from "@/lib/deletions";

/**
 * Deletes a Card at once, without asking, and shows "Card deleted" with Undo
 * for about 8 seconds. The toaster lives in the shell, so the toast outlasts
 * the page it was shown from. Undo restores the Card's Deletion, or says why
 * it couldn't, such as its Deck being deleted meanwhile. `then` runs once the
 * Card is deleted, before the toast shows, such as leaving its edit page; a
 * delete that fails shows an error toast instead, and leaves nothing.
 */
export async function deleteWithUndo(
  queryClient: QueryClient,
  card: Card,
  then?: () => Promise<unknown>,
) {
  const deleted = await deleteCard(queryClient, card);
  if (!deleted.ok) {
    toast.error(deleted.message);
    return;
  }
  await then?.();
  forgetCard(queryClient, card.id);
  const { deletionId } = deleted;
  toast("Card deleted", {
    id: `card-deleted-${card.id}`,
    duration: UNDO_MS,
    ...(deletionId === undefined
      ? {}
      : {
          action: {
            label: "Undo",
            onClick: () => {
              void restoreDeletion(queryClient, deletionId).then((restored) => {
                if (restored.ok) return;
                toast.error(
                  "placeDeleted" in restored
                    ? "Couldn't undo: the card's deck was deleted."
                    : restored.message,
                );
              });
            },
          },
        }),
  });
}
