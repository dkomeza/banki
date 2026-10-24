import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { ChevronLeft, Layers, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { Page } from "@/components/page";
import { OUTLINE_PILL } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ConfirmDelete } from "@/proto/confirm-delete";
import { DeckDialog } from "@/proto/deck-dialog";
import { NotFound } from "@/proto/deck-fields";
import {
  type Deck,
  createdLabel,
  deleteDeck,
  updateDeck,
  useDeck,
  useProtoState,
} from "@/proto/decks";

// Variant b, "Shelf": the deck page opens with the deck's cover, a card holding
// its name, description and when it was made, with Edit and Delete on it. Edit
// opens the same dialog as "New deck"; Delete asks in a dialog. The cards
// follow below, as wide as the cover.

export const Route = createFileRoute("/_shell/decks/$deckId")({
  component: DeckPage,
});

function DeckPage() {
  const { deckId } = Route.useParams();
  const state = useProtoState();
  const found = useDeck(deckId);
  const deck =
    state === "not-found" || found === undefined
      ? undefined
      : state === "no-description"
        ? { ...found, description: null }
        : found;

  return (
    <Page width="cards">
      <div className="flex flex-col gap-6 lg:gap-8">
        <Link
          to="/"
          className="-ml-1 inline-flex h-11 w-fit items-center gap-1 text-sm font-medium text-muted-foreground no-underline hover:text-foreground lg:h-8"
        >
          <ChevronLeft aria-hidden className="size-4" />
          Your decks
        </Link>
        {deck === undefined ? <NotFound /> : <DeckBody key={deck.id} deck={deck} state={state} />}
      </div>
    </Page>
  );
}

function DeckBody({ deck, state }: { deck: Deck; state: string | undefined }) {
  const navigate = useNavigate();
  const [editing, setEditing] = useState(state === "edit");
  const [deleting, setDeleting] = useState(state === "delete");

  return (
    <>
      <header className="flex flex-col gap-6 rounded-[1.5rem] border bg-card p-6 text-card-foreground sm:p-8 lg:flex-row lg:items-start lg:justify-between lg:gap-10 lg:p-10">
        <div className="flex min-w-0 flex-col gap-4">
          <h1 className="text-[2.25rem] leading-[1.05] font-semibold tracking-[-0.035em] [overflow-wrap:anywhere] lg:text-5xl">
            {deck.name}
          </h1>
          {deck.description !== null ? (
            <p className="max-w-prose text-[1.05rem] leading-relaxed whitespace-pre-line text-muted-foreground">
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
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" className={OUTLINE_PILL} onClick={() => setEditing(true)}>
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
      </header>

      <section aria-labelledby="cards-title" className="flex flex-col gap-4">
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
        initial={{ name: deck.name, description: deck.description ?? "" }}
        onSubmit={(name, description) => {
          const result = updateDeck(deck.id, name, description);
          if (result.ok) setEditing(false);
          return result;
        }}
      />
      <ConfirmDelete
        open={deleting}
        onOpenChange={setDeleting}
        name={deck.name}
        onConfirm={() => {
          deleteDeck(deck.id);
          void navigate({ to: "/" });
        }}
      />
    </>
  );
}
