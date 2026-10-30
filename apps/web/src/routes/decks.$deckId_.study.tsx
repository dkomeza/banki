import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { DeckNotFound } from "@/components/not-found";
import { Page } from "@/components/page";
import { StudyScreen } from "@/components/study/study-screen";
import { deckQueryOptions } from "@/lib/decks";

// The study screen: full-screen, outside the shell, with nothing but the Card.

export const Route = createFileRoute("/decks/$deckId_/study")({
  loader: ({ context: { queryClient }, params: { deckId } }) =>
    queryClient.ensureQueryData(deckQueryOptions(deckId)),
  component: StudyPage,
});

function StudyPage() {
  const { deckId } = Route.useParams();
  const { data: deck } = useSuspenseQuery(deckQueryOptions(deckId));
  if (deck === null)
    return (
      <Page width="reading">
        <DeckNotFound />
      </Page>
    );
  return <StudyScreen key={deck.id} deck={deck} />;
}
