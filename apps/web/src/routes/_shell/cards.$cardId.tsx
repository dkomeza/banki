import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { DeckMacros } from "@/components/cards/deck-macros";
import { EditCard } from "@/components/cards/edit-card";
import { CardNotFound } from "@/components/not-found";
import { Page } from "@/components/page";
import {
  type Card,
  cardHistoryQueryOptions,
  cardQueryOptions,
  cardsQueryOptions,
} from "@/lib/cards";
import { deckQueryOptions } from "@/lib/decks";
import { ensureLibrary } from "@/lib/folders";
import { tagsQueryOptions } from "@/lib/tags";

// The edit-card page, at a URL that doesn't name the Deck, so it outlasts a
// move. Save writes both sides, the Grading notes and the Tags and goes back to the Deck, to the
// list as it was last filtered there, putting a studied Card back to New too
// when Reset progress is ticked (never by default); Cancel goes back without writing; Delete deletes at once and goes back, with the Undo toast
// there. An unknown or deleted Card, or one whose Deck is deleted, shows
// "Card not found". The Card's History runs under the form, loaded beside it
// fresh each time the page opens.

export const Route = createFileRoute("/_shell/cards/$cardId")({
  loader: async ({ context: { queryClient }, params: { cardId } }) => {
    // Only for suggestions: the page doesn't wait for them, or fail without them.
    void queryClient.prefetchQuery(tagsQueryOptions());
    // Beside the Card, which the form doesn't wait for, and fails only its own section.
    void queryClient.prefetchQuery(cardHistoryQueryOptions(cardId));
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
    <DeckMacros own={deck.macros}>
      <EditCard key={card.id} deck={deck} card={card} />
    </DeckMacros>
  );
}
