import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { DeckMacros } from "@/components/cards/deck-macros";
import { DeckNotFound } from "@/components/not-found";
import { Page } from "@/components/page";
import { StudyScreen } from "@/components/study/study-screen";
import { deckQueryOptions } from "@/lib/decks";
import { settingsQueryOptions } from "@/lib/settings";

// The study screen: full-screen, outside the shell, with nothing but the Card.

export const Route = createFileRoute("/decks/$deckId_/study")({
  loader: ({ context: { queryClient }, params: { deckId } }) =>
    Promise.all([
      queryClient.ensureQueryData(deckQueryOptions(deckId)),
      // The end's offer of another batch names the New-card batch. Never thrown:
      // without the Settings the screen still studies, and the offer says less.
      queryClient.prefetchQuery(settingsQueryOptions()),
    ]),
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
  return (
    <DeckMacros own={deck.macros}>
      <StudyScreen key={deck.id} deck={deck} />
    </DeckMacros>
  );
}
