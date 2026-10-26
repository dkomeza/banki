import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { CornerDownRight, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { CardTimeline } from "@/components/cards/card-timeline";
import { ConfirmDelete } from "@/components/decks/confirm-delete";
import { Cover, Stack } from "@/components/decks/cover";
import { DeckDialog } from "@/components/decks/deck-dialog";
import { DeckNotFound } from "@/components/not-found";
import { Breadcrumb } from "@/components/folders/breadcrumb";
import { placeRoute, usePlaceActions } from "@/components/folders/place-actions";
import { useLibrary } from "@/components/folders/use-library";
import { Page } from "@/components/page";
import { OUTLINE_PILL } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import { cardCountLabel, cardsQueryOptions } from "@/lib/cards";
import {
  type Deck,
  createdLabel,
  deckQueryOptions,
  deleteDeck,
  forgetDeck,
  updateDeck,
} from "@/lib/decks";
import { ensureLibrary } from "@/lib/folders";
import { cn } from "@/lib/utils";

// The deck page opens with the breadcrumb from "Decks" down to the Deck, then
// the Deck's stack, its cover on top, beside the name and the whole
// description, with Edit, Move… and Delete under them. Edit opens the same
// dialog as create; Delete asks in a dialog, naming how many Cards go with
// it. The Cards follow below, on a timeline (CardTimeline).

export const Route = createFileRoute("/_shell/decks/$deckId")({
  loader: ({ context: { queryClient }, params: { deckId } }) =>
    Promise.all([
      queryClient.ensureQueryData(deckQueryOptions(deckId)),
      queryClient.ensureQueryData(cardsQueryOptions(deckId)),
      ensureLibrary(queryClient),
    ]),
  component: DeckPage,
});

function DeckPage() {
  const { deckId } = Route.useParams();
  const { data: deck } = useSuspenseQuery(deckQueryOptions(deckId));

  return (
    <Page width="cards">
      <div className="flex flex-col gap-6 lg:gap-8">
        {deck === null ? <DeckNotFound /> : <DeckBody key={deck.id} deck={deck} />}
      </div>
    </Page>
  );
}

function DeckBody({ deck }: { deck: Deck }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const library = useLibrary();
  const actions = usePlaceActions(library);
  // Null only when the Deck was deleted meanwhile, as its page is about to say.
  const cards = useSuspenseQuery(cardsQueryOptions(deck.id)).data ?? [];

  return (
    <>
      <Breadcrumb library={library} at={deck.folderId} last={deck.name} onMove={actions.drop} />
      <header className="flex flex-col gap-6 sm:flex-row sm:items-start sm:gap-8 lg:gap-10">
        <Stack className="aspect-[4/3] w-36 shrink-0 sm:w-48 lg:w-56">
          <Cover
            name={deck.name}
            className="w-full rounded-2xl border text-5xl sm:text-6xl lg:text-7xl"
          />
        </Stack>
        <div className="flex min-w-0 flex-col gap-4">
          <h1 className="text-[2.25rem] leading-[1.05] font-semibold tracking-[-0.035em] [overflow-wrap:anywhere] lg:text-5xl">
            {deck.name}
          </h1>
          {deck.description !== null ? (
            <p className="max-w-prose text-[1.05rem] leading-relaxed whitespace-pre-line text-muted-foreground [overflow-wrap:anywhere]">
              {deck.description}
            </p>
          ) : (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="min-h-11 w-fit text-left text-[1.05rem] text-muted-foreground italic underline-offset-4 lg:min-h-0 hover:text-foreground hover:underline"
            >
              Add a description
            </button>
          )}
          <p className="text-sm text-muted-foreground tabular-nums">
            Created {createdLabel(deck.createdAt)} · {cardCountLabel(cards.length).toLowerCase()}
          </p>
          <div className="flex shrink-0 flex-wrap gap-2 pt-1">
            <Button
              variant="outline"
              className={cn(OUTLINE_PILL, "h-11")}
              onClick={() => setEditing(true)}
            >
              <Pencil aria-hidden />
              Edit
            </Button>
            <Button
              variant="outline"
              className={cn(OUTLINE_PILL, "h-11")}
              onClick={() => actions.move({ kind: "deck", id: deck.id })}
            >
              <CornerDownRight aria-hidden />
              Move…
            </Button>
            <Button
              variant="outline"
              className={cn(OUTLINE_PILL, "h-11 text-destructive hover:text-destructive")}
              onClick={() => setDeleting(true)}
            >
              <Trash2 aria-hidden />
              Delete
            </Button>
          </div>
        </div>
      </header>

      <CardTimeline deckId={deck.id} cards={cards} />

      <DeckDialog
        open={editing}
        onOpenChange={setEditing}
        title="Edit deck"
        submitLabel="Save"
        submittingLabel="Saving…"
        initial={{ name: deck.name, description: deck.description ?? "" }}
        onSubmit={async (form) => {
          const outcome = await updateDeck(queryClient, deck.id, form);
          if (outcome.ok) setEditing(false);
          return outcome;
        }}
      />
      <ConfirmDelete
        open={deleting}
        onOpenChange={setDeleting}
        name={deck.name}
        description={
          <>
            <span className="font-medium text-foreground [overflow-wrap:anywhere]">
              “{deck.name}”
            </span>
            {cards.length === 0
              ? " will be deleted."
              : ` and its ${cardCountLabel(cards.length).toLowerCase()} will be deleted.`}
          </>
        }
        onConfirm={async () => {
          const outcome = await deleteDeck(queryClient, deck.id);
          if (!outcome.ok) return outcome.message;
          await navigate(placeRoute(deck.folderId));
          forgetDeck(queryClient, deck.id);
          return undefined;
        }}
      />
      {actions.dialogs}
    </>
  );
}
