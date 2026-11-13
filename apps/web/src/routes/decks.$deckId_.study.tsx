import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { DeckMacros } from "@/components/cards/deck-macros";
import { DeckNotFound } from "@/components/not-found";
import { Page } from "@/components/page";
import { StudyScreen } from "@/components/study/study-screen";
import { deckQueryOptions } from "@/lib/decks";
import { handwritingSearch } from "@/lib/handwriting";
import { settingsQueryOptions } from "@/lib/settings";

// The study screen: full-screen, outside the shell, with nothing but the Card.
// `?handwriting=1` shows the handwriting layout, with no control leading to it.

export const Route = createFileRoute("/decks/$deckId_/study")({
  validateSearch: handwritingSearch,
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
  const { handwriting } = Route.useSearch();
  const { data: deck } = useSuspenseQuery(deckQueryOptions(deckId));
  if (deck === null)
    return (
      <Page width="reading">
        <DeckNotFound />
      </Page>
    );
  return (
    <DeckMacros own={deck.macros}>
      <StudyScreen key={deck.id} deck={deck} handwriting={handwriting === 1} />
    </DeckMacros>
  );
}
