import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Breadcrumb } from "@/components/folders/breadcrumb";
import { usePlaceActions } from "@/components/folders/place-actions";
import { useLibrary } from "@/components/folders/use-library";
import { DeckNotFound } from "@/components/not-found";
import { Page } from "@/components/page";
import { StatisticsView } from "@/components/statistics/statistics-view";
import { type Deck, deckQueryOptions } from "@/lib/decks";
import { ensureLibrary } from "@/lib/folders";
import {
  type Statistics,
  deckStatisticsQueryOptions,
  rangeOf,
  searchFor,
  statisticsSearch,
} from "@/lib/statistics";

// A Deck's statistics, on a page of their own: the global page's view, of the
// Reviews whose Deck is this one, with the breadcrumb down to the Deck. A
// Deck that is gone shows the deck page's not-found.

export const Route = createFileRoute("/_shell/decks/$deckId_/statistics")({
  validateSearch: statisticsSearch,
  loaderDeps: ({ search }) => ({ range: rangeOf(search) }),
  loader: ({ context: { queryClient }, params: { deckId }, deps: { range } }) =>
    Promise.all([
      queryClient.ensureQueryData(deckQueryOptions(deckId)),
      queryClient.ensureQueryData(deckStatisticsQueryOptions(deckId, range)),
      ensureLibrary(queryClient),
    ]),
  component: DeckStatisticsPage,
});

function DeckStatisticsPage() {
  const { deckId } = Route.useParams();
  const range = rangeOf(Route.useSearch());
  const { data: deck } = useSuspenseQuery(deckQueryOptions(deckId));
  const { data: stats } = useSuspenseQuery(deckStatisticsQueryOptions(deckId, range));
  if (deck === null || stats === null)
    return (
      <Page width="cards">
        <div className="flex flex-col gap-6">
          <DeckNotFound />
        </div>
      </Page>
    );
  return <Body key={deck.id} deck={deck} stats={stats} />;
}

function Body({ deck, stats }: { deck: Deck; stats: Statistics }) {
  const navigate = useNavigate({ from: Route.fullPath });
  const library = useLibrary();
  const actions = usePlaceActions(library);
  return (
    <>
      <StatisticsView
        stats={stats}
        range={stats.range}
        onRange={(next) => void navigate({ search: searchFor(next), replace: true })}
        deckName={deck.name}
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
