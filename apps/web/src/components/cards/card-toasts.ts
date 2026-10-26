import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { type Card, deleteCard, forgetCard, restoreCard } from "@/lib/cards";

/** How long "Card deleted" stays up; hovering or focusing it keeps it open. */
const UNDO_MS = 8000;

/**
 * Deletes a Card at once, without asking, and shows "Card deleted" with Undo
 * for about 8 seconds. The toaster lives in the shell, so the toast outlasts
 * the page it was shown from. Undo brings the Card back, or says why it
 * couldn't, such as its Deck being deleted meanwhile. `then` runs once the
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
  toast("Card deleted", {
    id: `card-deleted-${card.id}`,
    duration: UNDO_MS,
    action: {
      label: "Undo",
      onClick: () => {
        void restoreCard(queryClient, card).then((restored) => {
          if (!restored.ok) toast.error(restored.message);
        });
      },
    },
  });
}
