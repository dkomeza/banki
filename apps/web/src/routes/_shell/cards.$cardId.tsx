import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { FormError } from "@/components/auth-card";
import { CardEditor, useCardForm } from "@/components/cards/card-editor";
import { deleteWithUndo } from "@/components/cards/card-toasts";
import { useDiscardGuard } from "@/components/cards/discard-guard";
import { CardNotFound } from "@/components/not-found";
import { Page } from "@/components/page";
import { OUTLINE_PILL, PILL } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import { dayLabel, timeLabel } from "@/lib/card-days";
import { type Card, cardQueryOptions, cardsQueryOptions, updateCard } from "@/lib/cards";
import { type Deck, deckQueryOptions } from "@/lib/decks";
import { ensureLibrary } from "@/lib/folders";
import { cn } from "@/lib/utils";

// The edit-card page, at a URL that doesn't name the Deck, so it outlasts a
// move. Save writes both sides and goes back to the Deck; Cancel goes back
// without writing; Delete deletes at once and goes back, with the Undo toast
// there. An unknown or deleted Card, or one whose Deck is deleted, shows
// "Card not found".

export const Route = createFileRoute("/_shell/cards/$cardId")({
  loader: async ({ context: { queryClient }, params: { cardId } }) => {
    const [card] = await Promise.all([
      queryClient.ensureQueryData(cardQueryOptions(cardId)),
      ensureLibrary(queryClient),
    ]);
    if (card !== null) {
      await Promise.all([
        queryClient.ensureQueryData(deckQueryOptions(card.deckId)),
        queryClient.ensureQueryData(cardsQueryOptions(card.deckId)),
      ]);
    }
  },
  component: EditCardPage,
});

function EditCardPage() {
  const { cardId } = Route.useParams();
  const { data: card } = useSuspenseQuery(cardQueryOptions(cardId));
  return card === null ? (
    <Page width="reading">
      <CardNotFound />
    </Page>
  ) : (
    <CardInDeck card={card} />
  );
}

function CardInDeck({ card }: { card: Card }) {
  const { data: deck } = useSuspenseQuery(deckQueryOptions(card.deckId));
  return deck === null ? (
    <Page width="reading">
      <CardNotFound />
    </Page>
  ) : (
    <EditCard key={card.id} deck={deck} card={card} />
  );
}

/** "Written today, 13:00", "Written Tue 20 Oct, 09:05". */
const writtenLabel = (createdAt: string) => {
  const day = dayLabel(createdAt);
  return `Written ${day === "Today" || day === "Yesterday" ? day.toLowerCase() : day}, ${timeLabel(createdAt)}`;
};

function EditCard({ deck, card }: { deck: Deck; card: Card }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const form = useCardForm({ front: card.front, back: card.back });
  const guard = useDiscardGuard(form.unsaved);
  const [formError, setFormError] = useState<string>();
  const saving = useRef(false);
  const toDeck = () => navigate({ to: "/decks/$deckId", params: { deckId: deck.id } });

  const save = async () => {
    if (saving.current) return;
    saving.current = true;
    setFormError(undefined);
    const outcome = await updateCard(queryClient, card.id, form.fields);
    saving.current = false;
    if (outcome.ok) {
      guard.release();
      await toDeck();
      return;
    }
    if ("errors" in outcome) form.setErrors(outcome.errors);
    else if ("notFound" in outcome) setFormError("This card, or its deck, was deleted meanwhile.");
    else setFormError(outcome.message);
  };

  // Deletes first, so a delete that fails leaves the page, and what's typed, as it was.
  const remove = () =>
    deleteWithUndo(queryClient, card, async () => {
      guard.release();
      await toDeck();
    });

  return (
    <>
      <CardEditor
        deck={deck}
        selfId={card.id}
        title="Edit card"
        dateline={writtenLabel(card.createdAt)}
        form={form}
        onSave={() => void save()}
        foot={
          <>
            <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
              <Button
                type="button"
                variant="ghost"
                className={cn(PILL, "-ml-3 h-11 text-destructive hover:text-destructive lg:h-10")}
                onClick={() => void remove()}
              >
                <Trash2 aria-hidden />
                Delete
              </Button>
              {formError !== undefined && <FormError>{formError}</FormError>}
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button
                type="button"
                variant="outline"
                className={cn(OUTLINE_PILL, "h-11 lg:h-10")}
                onClick={() => void toDeck()}
              >
                Cancel
              </Button>
              <Button type="submit" className={cn(PILL, "h-11 lg:h-10")}>
                Save
              </Button>
            </div>
          </>
        }
      />
      {guard.dialog}
    </>
  );
}
