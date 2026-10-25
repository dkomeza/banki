import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { ChevronLeft, Layers, Trash2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Page } from "@/components/page";
import { OUTLINE_PILL, PILL, SettingsCard } from "@/components/settings/parts";
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

// Variant g, "Open shelf" (builds on b, Shelf): the deck's name is the page's
// title, and under it the page splits like Settings: the cards take the wide
// column, and an "About this deck" card beside them holds the description,
// when it was made, Edit and Delete. Edit opens its form in place inside that
// card, on a muted background, rather than in b's dialog. On phones, About
// comes first.

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
      <h1 className="text-[2.25rem] leading-[1.05] font-semibold tracking-[-0.035em] [overflow-wrap:anywhere] lg:text-5xl">
        {deck.name}
      </h1>

      <div className="grid items-start gap-4 md:grid-cols-[minmax(0,1fr)_18rem] md:gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <SettingsCard id="about" title="About this deck" className="md:order-2">
          {editing ? (
            <EditForm deck={deck} onDone={() => setEditing(false)} />
          ) : (
            <>
              {deck.description !== null ? (
                <p className="leading-relaxed whitespace-pre-line">{deck.description}</p>
              ) : (
                <p className="text-muted-foreground italic">No description.</p>
              )}
              <p className="text-sm text-muted-foreground tabular-nums">
                Created {createdLabel(deck.createdAt)}
              </p>
              <div className="flex flex-wrap gap-2 border-t pt-4">
                <Button
                  variant="outline"
                  className={cn(OUTLINE_PILL, "h-11")}
                  onClick={() => setEditing(true)}
                >
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  className={cn(PILL, "h-11 text-destructive hover:text-destructive")}
                  onClick={() => setDeleting(true)}
                >
                  <Trash2 aria-hidden />
                  Delete deck
                </Button>
              </div>
            </>
          )}
        </SettingsCard>

        <SettingsCard id="cards" title="Cards" className="md:order-1">
          <div className="flex flex-col items-center gap-3 rounded-xl bg-muted px-6 py-14 text-center">
            <Layers aria-hidden className="size-8 text-muted-foreground" />
            <p className="text-lg font-medium">No cards yet</p>
            <p className="max-w-xs text-sm text-balance text-muted-foreground">
              Cards you add to this deck will be listed here.
            </p>
          </div>
        </SettingsCard>
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

/** Name and description, edited in place inside the About card. */
function EditForm({ deck, onDone }: { deck: Deck; onDone: () => void }) {
  const [name, setName] = useState(deck.name);
  const [description, setDescription] = useState(deck.description ?? "");
  const [error, setError] = useState<string>();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const result = updateDeck(deck.id, name, description);
    if (result.ok) onDone();
    else setError(result.error);
  };

  return (
    <form onSubmit={submit} className="-mx-2 flex flex-col gap-4 rounded-xl bg-muted p-4">
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
        <Button type="submit" className={cn(PILL, "h-11")}>
          Save
        </Button>
        <Button
          type="button"
          variant="outline"
          className={cn(OUTLINE_PILL, "h-11")}
          onClick={onDone}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
