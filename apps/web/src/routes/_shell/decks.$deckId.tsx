import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { ChevronLeft, Pencil, Trash2 } from "lucide-react";
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

// Variant e, "Stack" (builds on b, Shelf): the deck page drops b's cover card.
// The deck's name is the page's title, its description reads as plain text
// under it, and Edit and Delete sit in one quiet row beneath. The cards below
// wait in the same paper stack Home draws. Edit and Delete open b's dialogs.

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
      <header className="flex flex-col gap-5">
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
            className="-my-2 h-11 w-fit text-left text-[1.05rem] text-muted-foreground italic underline-offset-4 hover:text-foreground hover:underline lg:h-8"
          >
            Add a description
          </button>
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-y py-3">
          <p className="mr-auto text-sm text-muted-foreground tabular-nums">
            Created {createdLabel(deck.createdAt)} · 0 cards
          </p>
          <div className="flex gap-2">
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
              className={cn(OUTLINE_PILL, "h-11 text-destructive hover:text-destructive")}
              onClick={() => setDeleting(true)}
            >
              <Trash2 aria-hidden />
              Delete
            </Button>
          </div>
        </div>
      </header>

      <section aria-labelledby="cards-title" className="flex flex-col gap-5">
        <h2 id="cards-title" className="text-xl font-semibold tracking-tight">
          Cards
        </h2>
        <div className="flex flex-col items-center gap-6 py-8 text-center sm:py-12">
          <div aria-hidden className="relative isolate h-24 w-32">
            <span className="absolute inset-0 -z-20 translate-x-2 translate-y-2 rotate-[4deg] rounded-xl border border-dashed border-input" />
            <span className="absolute inset-0 -z-10 translate-x-1 translate-y-1 rotate-[2deg] rounded-xl border border-dashed border-input" />
            <span className="absolute inset-0 rounded-xl border border-dashed border-input bg-card" />
          </div>
          <div className="flex flex-col gap-1.5">
            <p className="text-lg font-medium">No cards yet</p>
            <p className="max-w-xs text-sm text-balance text-muted-foreground">
              Cards you add to this deck will be stacked here.
            </p>
          </div>
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
