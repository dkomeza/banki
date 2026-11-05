import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ImportSource } from "@/components/imports/source";
import { stateSearch } from "@/components/imports/parts";
import { DeckNotFound } from "@/components/not-found";
import { Page } from "@/components/page";
import { deckQueryOptions } from "@/lib/decks";
import { ensureLibrary } from "@/lib/folders";

// The import page: a Card file into this Deck, from a file or pasted JSON
// (BAN-32). Prototype: `?state=` shows each of its states.

export const Route = createFileRoute("/_shell/decks/$deckId_/import")({
  validateSearch: stateSearch,
  loader: ({ context: { queryClient }, params: { deckId } }) =>
    Promise.all([
      queryClient.ensureQueryData(deckQueryOptions(deckId)),
      ensureLibrary(queryClient),
    ]),
  component: ImportPage,
});

function ImportPage() {
  const { deckId } = Route.useParams();
  const { state } = Route.useSearch();
  const { data: deck } = useSuspenseQuery(deckQueryOptions(deckId));
  return deck === null ? (
    <Page width="reading">
      <DeckNotFound />
    </Page>
  ) : (
    <ImportSource key={`${deck.id}-${state ?? ""}`} deck={deck} state={state} />
  );
}
