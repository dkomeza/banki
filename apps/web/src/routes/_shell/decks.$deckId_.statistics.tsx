import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Breadcrumb } from "@/components/folders/breadcrumb";
import { usePlaceActions } from "@/components/folders/place-actions";
import { useLibrary } from "@/components/folders/use-library";
import { DeckNotFound } from "@/components/not-found";
import { Page } from "@/components/page";
import { StatisticsView } from "@/components/statistics/statistics-view";
import { cardsQueryOptions } from "@/lib/cards";
import { type Deck, deckQueryOptions } from "@/lib/decks";
import { ensureLibrary } from "@/lib/folders";
import { settingsQueryOptions } from "@/lib/settings";
import { statisticsSearch } from "@/lib/statistics-proto";

// A Deck's statistics, on a page of their own: the global page's view, scoped
// to the Reviews whose Deck is this one.

export const Route = createFileRoute("/_shell/decks/$deckId_/statistics")({
  validateSearch: statisticsSearch,
  loader: ({ context: { queryClient }, params: { deckId } }) =>
    Promise.all([
      queryClient.ensureQueryData(deckQueryOptions(deckId)),
      queryClient.ensureQueryData(settingsQueryOptions()),
      queryClient.ensureQueryData(cardsQueryOptions(deckId)),
      ensureLibrary(queryClient),
    ]),
  component: DeckStatisticsPage,
});

function DeckStatisticsPage() {
  const { deckId } = Route.useParams();
  const { data: deck } = useSuspenseQuery(deckQueryOptions(deckId));
  if (deck === null)
    return (
      <Page width="cards">
        <div className="flex flex-col gap-6">
          <DeckNotFound />
        </div>
      </Page>
    );
  return <Body key={deck.id} deck={deck} />;
}

function Body({ deck }: { deck: Deck }) {
  const search = Route.useSearch();
  const library = useLibrary();
  const actions = usePlaceActions(library);
  const cards = useSuspenseQuery(cardsQueryOptions(deck.id)).data ?? [];
  const { desiredRetention } = useSuspenseQuery(settingsQueryOptions()).data.settings;
  return (
    <>
      <StatisticsView
        scope={{
          kind: "deck",
          deckId: deck.id,
          desiredRetention: deck.desiredRetention ?? desiredRetention,
          cardCount: cards.length,
        }}
        deckName={deck.name}
        search={search}
        breadcrumb={
          <Breadcrumb
            library={library}
            at={deck.folderId}
            deck={{ id: deck.id, name: deck.name }}
            last="Statistics"
            onMove={actions.drop}
          />
        }
      />
      {actions.dialogs}
    </>
  );
}
