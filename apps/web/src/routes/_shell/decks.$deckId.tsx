import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { CornerDownRight, Layers, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { ConfirmDelete } from "@/components/decks/confirm-delete";
import { Cover, Stack } from "@/components/decks/cover";
import { DeckDialog } from "@/components/decks/deck-dialog";
import { Page } from "@/components/page";
import { OUTLINE_PILL } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import { createdLabel } from "@/lib/decks";
import { cn } from "@/lib/utils";
import {
  type Deck,
  deckClashFixture,
  protoDeck,
  deleteDeck,
  updateDeck,
  useLibrary,
  useProtoState,
} from "@/proto/folders";
import { useActions } from "@/proto/ui/actions";
import { Breadcrumb } from "@/proto/ui/tiles";

// PROTOTYPE (BAN-10): the deck page, under the breadcrumb from "Decks", with
// Move… beside Edit and Delete.

export const Route = createFileRoute("/_shell/decks/$deckId")({
  component: DeckPage,
});

function DeckPage() {
  const { deckId } = Route.useParams();
  const state = useProtoState();
  const deck = useLibrary().decks.find((d) => d.id === deckId);
  return (
    <Page width="cards">
      <div className="flex flex-col gap-6 lg:gap-8">
        {deck === undefined ? (
          <DeckNotFound />
        ) : (
          <DeckBody key={`${deck.id}-${state ?? ""}`} deck={deck} state={state} />
        )}
      </div>
    </Page>
  );
}

function DeckBody({ deck, state }: { deck: Deck; state: string | undefined }) {
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const actions = useActions({
    moving: state === "move" ? { item: { kind: "deck", id: deck.id }, name: deck.name } : undefined,
    clash: state === "clash" ? deckClashFixture(deck) : undefined,
  });

  return (
    <>
      <Breadcrumb at={deck.folderId} last={deck.name} onMove={actions.drop} />
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
          {deck.description !== null && (
            <p className="max-w-prose text-[1.05rem] leading-relaxed whitespace-pre-line text-muted-foreground [overflow-wrap:anywhere]">
              {deck.description}
            </p>
          )}
          <p className="text-sm text-muted-foreground tabular-nums">
            Created {createdLabel(deck.createdAt)} · 0 cards
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
              onClick={() => actions.move({ kind: "deck", id: deck.id }, deck.name)}
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
          const outcome = updateDeck(deck.id, form.name, form.description);
          if (!outcome.ok) return { ok: false, field: "name", message: outcome.error };
          setEditing(false);
          return { ok: true, deck: protoDeck(outcome.id, form) };
        }}
      />
      <ConfirmDelete
        open={deleting}
        onOpenChange={setDeleting}
        name={deck.name}
        onConfirm={async () => {
          await navigate(
            deck.folderId === null
              ? { to: "/" }
              : { to: "/folders/$folderId", params: { folderId: deck.folderId } },
          );
          deleteDeck(deck.id);
          return undefined;
        }}
      />
      {actions.dialogs}
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
      <Link to="/" className="inline-flex h-11 items-center font-medium lg:h-auto">
        Back to Home
      </Link>
    </div>
  );
}
