import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { DeckNotFound } from "@/components/not-found";
import { Page } from "@/components/page";
import { StudyScreen } from "@/components/study/study-screen";
import { deckQueryOptions } from "@/lib/decks";
import { studySearch } from "@/lib/study-proto";

// PROTOTYPE (BAN-26): the study screen. `?state=<name>` opens one of the
// Prototype section's states (see study-proto.ts).

export const Route = createFileRoute("/_shell/decks/$deckId_/study")({
  validateSearch: studySearch,
  loader: ({ context: { queryClient }, params: { deckId } }) =>
    queryClient.ensureQueryData(deckQueryOptions(deckId)),
  component: StudyPage,
});

function StudyPage() {
  const { deckId } = Route.useParams();
  const { state } = Route.useSearch();
  const { data: deck } = useSuspenseQuery(deckQueryOptions(deckId));
  if (deck === null)
    return (
      <Page width="reading">
        <DeckNotFound />
      </Page>
    );
  return <StudyScreen key={`${deck.id}-${state ?? ""}`} deck={deck} state={state} />;
}
