import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, useLocation } from "@tanstack/react-router";
import { DeckNotFound } from "@/components/not-found";
import { Page } from "@/components/page";
import { PromptPage } from "@/components/prompt/prompt-page";
import { deckQueryOptions } from "@/lib/decks";
import { ensureLibrary } from "@/lib/folders";
import { settingsQueryOptions } from "@/lib/settings";

// The Card prompt's page: this Deck's options for the prompt, the prompt to
// copy into an LLM, and the Card file's JSON Schema (CONTEXT.md: Card prompt).
// A deleted or unknown Deck's page is not found.

export const Route = createFileRoute("/_shell/decks/$deckId_/prompt")({
  loader: ({ context: { queryClient }, params: { deckId } }) =>
    Promise.all([
      queryClient.ensureQueryData(deckQueryOptions(deckId)),
      queryClient.ensureQueryData(settingsQueryOptions()),
      ensureLibrary(queryClient),
    ]),
  component: CardPromptRoute,
});

function CardPromptRoute() {
  const { deckId } = Route.useParams();
  const { data: deck } = useSuspenseQuery(deckQueryOptions(deckId));
  // PROTOTYPE: the Variant's `?state=`, which restarts the page when it changes.
  const state = useLocation({
    select: (l) => {
      const search: Record<string, unknown> = l.search;
      return typeof search["state"] === "string" ? search["state"] : undefined;
    },
  });
  return deck === null ? (
    <Page width="reading">
      <DeckNotFound />
    </Page>
  ) : (
    <PromptPage key={`${deck.id}-${state ?? ""}`} deck={deck} state={state} />
  );
}
