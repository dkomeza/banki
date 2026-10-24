import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { ChevronLeft, Layers, Pencil, Trash2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Page } from "@/components/page";
import { OUTLINE_PILL, PILL } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ConfirmDelete } from "@/proto/confirm-delete";
import { DeckFields, NotFound } from "@/proto/deck-fields";
import { type Deck, deleteDeck, updateDeck, useDeck, useProtoState } from "@/proto/decks";

// Variant a, "Ledger": the deck page is a reading column. Name and description
// head it, with Edit and Delete as pills underneath; Edit swaps the heading for
// its form in place, Delete asks in a dialog.

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
    <Page width="reading">
      <div className="flex flex-col gap-6 lg:gap-8">
        <Link
          to="/"
          className="-ml-1 inline-flex h-11 w-fit items-center gap-1 text-sm font-medium text-muted-foreground no-underline hover:text-foreground lg:h-8"
        >
          <ChevronLeft aria-hidden className="size-4" />
          Home
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
      {editing ? (
        <EditForm deck={deck} onDone={() => setEditing(false)} />
      ) : (
        <header className="flex flex-col gap-4">
          <h1 className="text-[2.25rem] leading-[1.05] font-semibold tracking-[-0.035em] [overflow-wrap:anywhere] lg:text-5xl">
            {deck.name}
          </h1>
          {deck.description !== null && (
            <p className="max-w-prose text-[1.05rem] leading-relaxed whitespace-pre-line text-muted-foreground">
              {deck.description}
            </p>
          )}
          <div className="mt-1 flex flex-wrap gap-2">
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
      )}

      <section
        aria-labelledby="cards-title"
        className="flex flex-col gap-4 rounded-[1.25rem] border bg-card p-5 sm:p-6"
      >
        <h2 id="cards-title" className="text-xl font-semibold tracking-tight">
          Cards
        </h2>
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-input/60 px-6 py-12 text-center">
          <Layers aria-hidden className="size-7 text-muted-foreground" />
          <p className="font-medium">No cards yet</p>
          <p className="max-w-xs text-sm text-balance text-muted-foreground">
            Cards you add to this deck will be listed here.
          </p>
        </div>
      </section>

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

function EditForm({ deck, onDone }: { deck: Deck; onDone: () => void }) {
  const [name, setName] = useState(deck.name);
  const [description, setDescription] = useState(deck.description ?? "");
  const [error, setError] = useState<string | undefined>();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const result = updateDeck(deck.id, name, description);
    if (result.ok) onDone();
    else setError(result.error);
  };

  return (
    <form
      onSubmit={submit}
      aria-labelledby="edit-title"
      className="flex flex-col gap-5 rounded-[1.25rem] border bg-muted p-5 sm:p-6"
    >
      <h1 id="edit-title" className="text-xl font-semibold tracking-tight">
        Edit deck
      </h1>
      <DeckFields
        name={name}
        description={description}
        onName={(v) => {
          setName(v);
          setError(undefined);
        }}
        onDescription={setDescription}
        error={error}
        autoFocus
        rows={5}
      />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" className={PILL}>
          Save
        </Button>
        <Button type="button" variant="outline" className={OUTLINE_PILL} onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
