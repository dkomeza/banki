import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { ChevronLeft, Layers, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { Page } from "@/components/page";
import { OUTLINE_PILL } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ConfirmDelete } from "@/proto/confirm-delete";
import { DeckDialog } from "@/proto/deck-dialog";
import { Cover, Stack } from "@/proto/cover";
import { NotFound } from "@/proto/deck-fields";
import {
  type Deck,
  createdLabel,
  deleteDeck,
  updateDeck,
  useDeck,
  useProtoState,
} from "@/proto/decks";

// Variant h, "Covered stack" (builds on e, Stack, with f's covers): the deck
// page opens with the deck's stack, its cover on top, beside the name and the
// whole description, with Edit and Delete under them. Edit opens b's dialog;
// Delete asks in a dialog. The cards follow below.

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
          Decks
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
