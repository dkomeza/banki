import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Page } from "@/components/page";
import { deckQueryOptions } from "@/lib/decks";
import { ensureLibrary } from "@/lib/folders";
import { DeckNotFound } from "@/proto/not-found";
import { NewCardScreen } from "@/proto/screens";

// PROTOTYPE (BAN-12): the new-card page. The Variant's look is in
// proto/screens.tsx.

export const Route = createFileRoute("/_shell/decks/$deckId_/cards/new")({
  loader: ({ context: { queryClient }, params: { deckId } }) =>
    Promise.all([
      queryClient.ensureQueryData(deckQueryOptions(deckId)),
      ensureLibrary(queryClient),
    ]),
  component: NewCardPage,
});

function NewCardPage() {
  const { deckId } = Route.useParams();
  const { data: deck } = useSuspenseQuery(deckQueryOptions(deckId));
  return deck === null ? (
    <Page width="cards">
      <DeckNotFound />
    </Page>
  ) : (
    <NewCardScreen key={deck.id} deck={deck} />
  );
}
