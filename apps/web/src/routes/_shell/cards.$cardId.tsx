import { createFileRoute } from "@tanstack/react-router";
import { useLibrary } from "@/components/folders/use-library";
import { Page } from "@/components/page";
import { ensureLibrary } from "@/lib/folders";
import { useCard, useProtoState } from "@/proto/cards";
import { CardNotFound } from "@/proto/not-found";
import { EditCardScreen } from "@/proto/screens";

// PROTOTYPE (BAN-12): the edit-card page. The Variant's look is in
// proto/screens.tsx.

export const Route = createFileRoute("/_shell/cards/$cardId")({
  loader: ({ context: { queryClient } }) => ensureLibrary(queryClient),
  component: EditCardPage,
});

function EditCardPage() {
  const { cardId } = Route.useParams();
  const state = useProtoState();
  const found = useCard(cardId);
  const library = useLibrary();
  const card = state === "not-found" ? undefined : found;
  const deck = library.decks.find((d) => d.id === card?.deckId);

  return card === undefined || deck === undefined ? (
    <Page width="cards">
      <CardNotFound />
    </Page>
  ) : (
    <EditCardScreen key={card.id} deck={deck} card={card} />
  );
}
