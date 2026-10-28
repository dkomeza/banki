import type { QueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { UNDO_MS } from "@/components/deleted/toasts";
import { type Card, deleteCard, deleteCards, forgetCard, moveCards } from "@/lib/cards";
import { restoreDeletion, restoreDeletions } from "@/lib/deletions";

/**
 * Deletes a Card at once, without asking, and shows "Card deleted" with Undo
 * for about 8 seconds. The toaster lives in the shell, so the toast outlasts
 * the page it was shown from. Undo restores the Card's Deletion, or says why
 * it couldn't, such as its Deck being deleted meanwhile. `then` runs once the
 * Card is deleted, before the toast shows, such as leaving its edit page; a
 * delete that fails shows an error toast instead, and leaves nothing.
 * Answers whether the Card was deleted.
 */
export async function deleteWithUndo(
  queryClient: QueryClient,
  card: Card,
  then?: () => Promise<unknown>,
): Promise<boolean> {
  const deleted = await deleteCard(queryClient, card);
  if (!deleted.ok) {
    toast.error(deleted.message);
    return false;
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
  return true;
}

/** "Moved card to " or "Moved 3 cards to ", before the Deck's name. */
export const movedTitle = (count: number) =>
  count === 1 ? "Moved card to " : `Moved ${count} cards to `;

/**
 * After a Move: "Moved 3 cards to Verbs", the Deck's name linking to it, with
 * Undo for about 8 seconds, which moves the Cards back to `from` in one
 * request, or says why it couldn't: `from` or one of the Cards deleted
 * meanwhile.
 */
export function showMovedToast(
  queryClient: QueryClient,
  ids: readonly string[],
  from: { id: string; name: string },
  to: { id: string; name: string },
) {
  const id = `moved-${ids[0] ?? ""}-${ids.length}`;
  toast(
    <span>
      {movedTitle(ids.length)}
      <Link
        to="/decks/$deckId"
        params={{ deckId: to.id }}
        className="font-semibold text-foreground underline underline-offset-4 [overflow-wrap:anywhere]"
        onClick={() => toast.dismiss(id)}
      >
        {to.name}
      </Link>
    </span>,
    {
      id,
      duration: UNDO_MS,
      action: {
        label: "Undo",
        onClick: () => {
          void moveCards(queryClient, ids, to.id, from.id).then((back) => {
            if (back.ok) return;
            toast.error(
              "notFound" in back
                ? `Couldn't undo: ${from.name} or one of the cards was deleted.`
                : back.message,
            );
          });
        },
      },
    },
  );
}

/**
 * Deletes the selected Cards of the Deck `deckId` at once, without asking,
 * each as a Deletion of its own, and shows "3 cards deleted" with Undo for
 * about 8 seconds, which restores all of them, or says why it couldn't. One
 * Card alone is {@link deleteWithUndo}'s, with its "Card deleted". A delete
 * that fails shows an error toast instead, and leaves the Cards. Answers
 * whether they were deleted.
 */
export async function deleteAllWithUndo(
  queryClient: QueryClient,
  deckId: string,
  cards: readonly Card[],
): Promise<boolean> {
  const [one] = cards;
  if (one === undefined) return false;
  if (cards.length === 1) return deleteWithUndo(queryClient, one);
  const deleted = await deleteCards(
    queryClient,
    deckId,
    cards.map((card) => card.id),
  );
  if (!deleted.ok) {
    toast.error(deleted.message);
    return false;
  }
  for (const card of cards) forgetCard(queryClient, card.id);
  const { deletionIds } = deleted;
  toast(`${cards.length} cards deleted`, {
    id: `cards-deleted-${one.id}-${cards.length}`,
    duration: UNDO_MS,
    action: {
      label: "Undo",
      onClick: () => {
        void restoreDeletions(queryClient, deletionIds).then((restored) => {
          if (restored.ok) return;
          toast.error(
            "placeDeleted" in restored
              ? "Couldn't undo: the cards' deck was deleted."
              : restored.message,
          );
        });
      },
    },
  });
  return true;
}
