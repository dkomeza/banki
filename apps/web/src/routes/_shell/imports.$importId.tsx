import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { DeckMacros } from "@/components/cards/deck-macros";
import { IMPORT_DECK_ID, MANY, PREVIEW, REPORT, REPORT_CLEAN } from "@/components/imports/fixtures";
import { ImportPreviewPage, ImportReportPage } from "@/components/imports/import-page";
import { stateSearch } from "@/components/imports/parts";
import { NotFound } from "@/components/not-found";
import { Page } from "@/components/page";
import { cardsQueryOptions } from "@/lib/cards";
import { deckQueryOptions } from "@/lib/decks";
import { ensureLibrary } from "@/lib/folders";
import { settingsQueryOptions } from "@/lib/settings";

// An Import's page (BAN-32): its preview until it is confirmed, then its
// report, for good. Prototype: the Import is made up in the browser, and
// `?state=` picks which one shows.

export const Route = createFileRoute("/_shell/imports/$importId")({
  validateSearch: stateSearch,
  loader: ({ context: { queryClient } }) =>
    Promise.all([
      queryClient.ensureQueryData(deckQueryOptions(IMPORT_DECK_ID)),
      queryClient.ensureQueryData(cardsQueryOptions(IMPORT_DECK_ID)),
      queryClient.ensureQueryData(settingsQueryOptions()),
      ensureLibrary(queryClient),
    ]),
  component: ImportPage,
});

function ImportPage() {
  const { state } = Route.useSearch();
  const { data: deck } = useSuspenseQuery(deckQueryOptions(IMPORT_DECK_ID));
  if (deck === null) {
    return (
      <Page width="reading">
        <NotFound title="Import not found" />
      </Page>
    );
  }
  const preview =
    state === "preview" || state === "edit" || state === "confirming"
      ? PREVIEW
      : state === "many"
        ? MANY
        : undefined;
  if (preview !== undefined) {
    const added = preview.macros
      .filter((macro) => macro.outcome === "added")
      .map(({ name, definition }) => ({ name, definition }));
    return (
      <DeckMacros own={[...deck.macros, ...added]}>
        <ImportPreviewPage key={state} deck={deck} preview={preview} state={state} />
      </DeckMacros>
    );
  }
  return (
    <DeckMacros own={deck.macros}>
      <ImportReportPage
        key={state}
        deck={deck}
        report={state === "report-clean" ? REPORT_CLEAN : REPORT}
      />
    </DeckMacros>
  );
}
