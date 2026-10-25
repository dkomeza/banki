import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { ChevronLeft, Layers, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { ConfirmDelete } from "@/components/decks/confirm-delete";
import { Cover, Stack } from "@/components/decks/cover";
import { DeckDialog } from "@/components/decks/deck-dialog";
import { Page } from "@/components/page";
import { OUTLINE_PILL } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import {
  type Deck,
  createdLabel,
  deckQueryOptions,
  deleteDeck,
  forgetDeck,
  updateDeck,
} from "@/lib/decks";
import { cn } from "@/lib/utils";

// The deck page opens with the Deck's stack, its cover on top, beside the name
// and the whole description, with Edit and Delete under them. Edit opens the
// same dialog as create; Delete asks in a dialog. The cards follow below.

export const Route = createFileRoute("/_shell/decks/$deckId")({
  loader: ({ context: { queryClient }, params: { deckId } }) =>
    queryClient.ensureQueryData(deckQueryOptions(deckId)),
  component: DeckPage,
});

function DeckPage() {
  const { deckId } = Route.useParams();
  const { data: deck } = useSuspenseQuery(deckQueryOptions(deckId));

  return (
    <Page width="cards">
      <div className="flex flex-col gap-6 lg:gap-8">
        <Link
          to="/"
          className="-ml-1 inline-flex h-11 w-fit items-center gap-1 text-sm font-medium text-muted-foreground no-underline hover:text-foreground lg:h-8"
        >
          <ChevronLeft aria-hidden className="size-4" />
          Decks
        </Link>
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

  return (
    <>
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
              className="w-fit text-left text-[1.05rem] text-muted-foreground/80 italic underline-offset-4 hover:text-foreground hover:underline"
            >
              Add a description
            </button>
          )}
          <p className="text-sm text-muted-foreground tabular-nums">
            Created {createdLabel(deck.createdAt)} · 0 cards
          </p>
          <div className="flex shrink-0 gap-2 pt-1">
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
              className={cn(OUTLINE_PILL, "text-destructive hover:text-destructive")}
              onClick={() => setDeleting(true)}
            >
              <Trash2 aria-hidden />
              Delete
            </Button>
          </div>
        </div>
      </header>

      <section aria-labelledby="cards-title" className="flex flex-col gap-4 border-t pt-6 lg:pt-8">
        <h2 id="cards-title" className="text-xl font-semibold tracking-tight">
          Cards
        </h2>
        <div className="flex flex-col items-center gap-3 rounded-[1.25rem] border-2 border-dashed border-input/60 px-6 py-16 text-center">
          <Layers aria-hidden className="size-8 text-muted-foreground" />
          <p className="text-lg font-medium">No cards yet</p>
          <p className="max-w-xs text-sm text-balance text-muted-foreground">
            Cards you add to this deck will be shown here.
          </p>
        </div>
      </section>

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
        onConfirm={async () => {
          const outcome = await deleteDeck(queryClient, deck.id);
          if (!outcome.ok) return outcome.message;
          await navigate({ to: "/" });
          forgetDeck(queryClient, deck.id);
          return undefined;
        }}
      />
    </>
  );
}

/** An unknown or deleted Deck's page, with the way back to Home. */
function DeckNotFound() {
  return (
    <div className="flex flex-col items-start gap-4 py-10">
      <h1 className="text-[2.25rem] leading-none font-semibold tracking-[-0.035em] lg:text-5xl">
        Deck not found
      </h1>
      <p className="text-muted-foreground">It may have been deleted, or the link is wrong.</p>
      <Link to="/" className="font-medium">
        Back to Home
      </Link>
    </div>
  );
}
