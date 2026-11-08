import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { DeckMacros } from "@/components/cards/deck-macros";
import { ImportPreviewPage, ImportReportPage } from "@/components/imports/import-page";
import { NotFound } from "@/components/not-found";
import { Page } from "@/components/page";
import { cardsQueryOptions } from "@/lib/cards";
import { deckQueryOptions } from "@/lib/decks";
import { ensureLibrary } from "@/lib/folders";
import { importQueryOptions } from "@/lib/imports";
import { settingsQueryOptions } from "@/lib/settings";

// An Import's page (CONTEXT.md, ADR-0026): its preview until it is
// confirmed, then its report, for good, at the same URL. The preview renders
// its Cards with the Deck's Macros as they will be after the Import.

export const Route = createFileRoute("/_shell/imports/$importId")({
  loader: async ({ context: { queryClient }, params: { importId } }) => {
    const [found] = await Promise.all([
      queryClient.ensureQueryData(importQueryOptions(importId)),
      queryClient.ensureQueryData(settingsQueryOptions()),
      ensureLibrary(queryClient),
    ]);
    if (found === null) return;
    await Promise.all([
      queryClient.ensureQueryData(deckQueryOptions(found.deckId)),
      queryClient.ensureQueryData(cardsQueryOptions(found.deckId)),
    ]);
  },
  component: ImportPage,
});

function ImportPage() {
  const { importId } = Route.useParams();
  const { data: found } = useSuspenseQuery(importQueryOptions(importId));
  if (found === null) {
    return (
      <Page width="reading">
        <NotFound title="Import not found" />
      </Page>
    );
  }
  return <ImportOfDeck key={found.id} deckId={found.deckId} importId={importId} />;
}

function ImportOfDeck({ deckId, importId }: { deckId: string; importId: string }) {
  const { data: found } = useSuspenseQuery(importQueryOptions(importId));
  const { data: deck } = useSuspenseQuery(deckQueryOptions(deckId));
  if (found === null || deck === null) {
    return (
      <Page width="reading">
        <NotFound title={found === null ? "Import not found" : "Deck not found"} />
      </Page>
    );
  }
  if (found.status === "confirmed") {
    return (
      <DeckMacros own={deck.macros}>
        <ImportReportPage deck={deck} report={found} />
      </DeckMacros>
    );
  }
  const added = found.macros.flatMap((macro) =>
    macro.outcome === "added" ? [{ name: macro.name, definition: macro.definition }] : [],
  );
  return (
    <DeckMacros own={added.length === 0 ? deck.macros : [...deck.macros, ...added]}>
      <ImportPreviewPage deck={deck} preview={found} />
    </DeckMacros>
  );
}
