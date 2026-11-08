import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ImportSource } from "@/components/imports/source";
import { DeckNotFound } from "@/components/not-found";
import { Page } from "@/components/page";
import { deckQueryOptions } from "@/lib/decks";
import { ensureLibrary } from "@/lib/folders";

// The import page: a Card file into this Deck, from a file or pasted JSON
// (CONTEXT.md: Import). Only ever into a live Deck: a deleted or unknown
// one's page is not found.

export const Route = createFileRoute("/_shell/decks/$deckId_/import")({
  loader: ({ context: { queryClient }, params: { deckId } }) =>
    Promise.all([
      queryClient.ensureQueryData(deckQueryOptions(deckId)),
      ensureLibrary(queryClient),
    ]),
  component: ImportPage,
});

function ImportPage() {
  const { deckId } = Route.useParams();
  const { data: deck } = useSuspenseQuery(deckQueryOptions(deckId));
  return deck === null ? (
    <Page width="reading">
      <DeckNotFound />
    </Page>
  ) : (
    <ImportSource key={deck.id} deck={deck} />
  );
}
