import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { ChevronLeft, Layers } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Page } from "@/components/page";
import { OUTLINE_PILL, PILL } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ConfirmDelete } from "@/proto/confirm-delete";
import { DeckFields, NotFound } from "@/proto/deck-fields";
import {
  type Deck,
  createdLabel,
  deleteDeck,
  updateDeck,
  useDeck,
  useProtoState,
} from "@/proto/decks";

// Variant c, "Index": the deck page is a page of cards, like Settings. The
// title is the deck's name; the Cards card comes first, full width, since the
// deck is about its cards. Beside it from 768 px, "About this deck" shows the
// name and description as rows with Edit beside them, opening the form in
// place on a muted background, and a last card holds Delete.

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
          Home
        </Link>
        {deck === undefined ? <NotFound /> : <DeckBody key={deck.id} deck={deck} state={state} />}
      </div>
    </Page>
  );
}

const CARD = "flex flex-col gap-5 rounded-[1.25rem] border bg-card p-5 text-card-foreground sm:p-6";

function DeckBody({ deck, state }: { deck: Deck; state: string | undefined }) {
  const navigate = useNavigate();
  const [editing, setEditing] = useState(state === "edit");
  const [deleting, setDeleting] = useState(state === "delete");

  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="text-[2.25rem] leading-[1.05] font-semibold tracking-[-0.035em] [overflow-wrap:anywhere] lg:text-5xl">
          {deck.name}
        </h1>
        <p className="text-muted-foreground tabular-nums">
          Created {createdLabel(deck.createdAt)} · no cards
        </p>
      </div>

      <div className="grid items-start gap-5 md:grid-cols-[minmax(0,1fr)_20rem] lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section aria-labelledby="cards-title" className={cn(CARD, "md:row-span-2")}>
          <h2 id="cards-title" className="text-xl font-semibold tracking-tight">
            Cards
          </h2>
          <div className="flex flex-col items-center gap-3 rounded-xl bg-muted px-6 py-14 text-center">
            <Layers aria-hidden className="size-7 text-muted-foreground" />
            <p className="font-medium">No cards yet</p>
            <p className="max-w-xs text-sm text-balance text-muted-foreground">
              The cards you add to this deck will be listed here.
            </p>
          </div>
        </section>

        <section aria-labelledby="about-title" className={CARD}>
          <h2 id="about-title" className="text-xl font-semibold tracking-tight">
            About this deck
          </h2>
          {editing ? (
            <EditForm deck={deck} onDone={() => setEditing(false)} />
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex items-start gap-3">
                <div className="flex min-w-0 flex-1 flex-col gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Name</p>
                    <p className="text-[1.05rem] font-medium [overflow-wrap:anywhere]">
                      {deck.name}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Description</p>
                    {deck.description !== null ? (
                      <p className="leading-relaxed whitespace-pre-line">{deck.description}</p>
                    ) : (
                      <p className="text-muted-foreground italic">None</p>
                    )}
                  </div>
                </div>
                <Button
                  variant="outline"
                  className={cn(OUTLINE_PILL, "-mt-0.5")}
                  onClick={() => setEditing(true)}
                >
                  Edit
                </Button>
              </div>
            </div>
          )}
        </section>

        <section aria-labelledby="delete-title" className={CARD}>
          <h2 id="delete-title" className="text-xl font-semibold tracking-tight">
            Delete deck
          </h2>
          <p className="-mt-2 text-sm text-muted-foreground">
            The deck and its cards disappear from Banki.
          </p>
          <Button
            variant="outline"
            className={cn(
              OUTLINE_PILL,
              "w-fit border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive",
            )}
            onClick={() => setDeleting(true)}
          >
            Delete this deck
          </Button>
        </section>
      </div>

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
      aria-label="Edit deck"
      className="flex flex-col gap-4 rounded-xl bg-muted p-4"
    >
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
