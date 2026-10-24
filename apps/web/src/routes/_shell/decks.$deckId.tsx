import { Menu } from "@base-ui/react/menu";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { ChevronLeft, Ellipsis, Layers, Pencil, Trash2 } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { Page } from "@/components/page";
import { FIELD, OUTLINE_PILL, PILL } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ConfirmDelete } from "@/proto/confirm-delete";
import { NotFound } from "@/proto/deck-fields";
import { DeckList } from "@/proto/deck-list";
import {
  type Deck,
  createdLabel,
  deleteDeck,
  updateDeck,
  useDeck,
  useProtoState,
} from "@/proto/decks";

// Variant d, "Desk": from 1024 px the deck list stays on the desk beside the
// deck, the current one marked, so moving between decks is one click. The deck
// is edited where it is written: Edit turns its heading and description into
// fields in place. Delete sits in the "…" menu beside Edit and asks first.

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
      <div className="grid items-start gap-8 lg:grid-cols-[17rem_minmax(0,1fr)] lg:gap-10">
        <aside className="sticky top-12 hidden lg:block">
          <DeckList currentId={deck?.id} compact />
        </aside>
        <div className="flex min-w-0 flex-col gap-6 lg:gap-8">
          <Link
            to="/"
            className="-ml-1 inline-flex h-11 w-fit items-center gap-1 text-sm font-medium text-muted-foreground no-underline hover:text-foreground lg:hidden"
          >
            <ChevronLeft aria-hidden className="size-4" />
            Home
          </Link>
          {deck === undefined ? <NotFound /> : <DeckBody key={deck.id} deck={deck} state={state} />}
        </div>
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
        <EditInPlace deck={deck} onDone={() => setEditing(false)} />
      ) : (
        <header className="flex flex-col gap-4">
          <div className="flex items-start justify-between gap-4">
            <h1 className="text-[2.25rem] leading-[1.05] font-semibold tracking-[-0.035em] [overflow-wrap:anywhere] lg:text-5xl">
              {deck.name}
            </h1>
            <div className="flex shrink-0 gap-1.5 pt-1 lg:pt-2">
              <Button variant="outline" className={OUTLINE_PILL} onClick={() => setEditing(true)}>
                <Pencil aria-hidden />
                Edit
              </Button>
              <Menu.Root>
                <Menu.Trigger
                  render={
                    <Button
                      variant="outline"
                      size="icon"
                      className="rounded-full border-input bg-background lg:size-10 dark:bg-input/20"
                    />
                  }
                  aria-label="More"
                >
                  <Ellipsis aria-hidden />
                </Menu.Trigger>
                <Menu.Portal>
                  <Menu.Positioner align="end" sideOffset={6} className="z-40">
                    <Menu.Popup className="min-w-44 rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-xl outline-none">
                      <Menu.Item
                        onClick={() => setDeleting(true)}
                        className="flex min-h-11 cursor-default items-center gap-2.5 rounded-lg px-3 text-[0.95rem] text-destructive outline-none data-[highlighted]:bg-destructive/10 lg:min-h-9"
                      >
                        <Trash2 aria-hidden className="size-4" />
                        Delete deck…
                      </Menu.Item>
                    </Menu.Popup>
                  </Menu.Positioner>
                </Menu.Portal>
              </Menu.Root>
            </div>
          </div>
          {deck.description !== null && (
            <p className="max-w-prose text-[1.05rem] leading-relaxed whitespace-pre-line text-muted-foreground">
              {deck.description}
            </p>
          )}
          <p className="text-sm text-muted-foreground tabular-nums">
            Created {createdLabel(deck.createdAt)}
          </p>
        </header>
      )}

      <section
        aria-labelledby="cards-title"
        className="flex flex-col gap-4 rounded-[1.25rem] border bg-card p-5 sm:p-6"
      >
        <h2 id="cards-title" className="text-xl font-semibold tracking-tight">
          Cards
        </h2>
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-input/60 px-6 py-14 text-center">
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

/** The heading and description, turned into fields where they stand. */
function EditInPlace({ deck, onDone }: { deck: Deck; onDone: () => void }) {
  const id = useId();
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
    <form onSubmit={submit} aria-label="Edit deck" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-name`} className="text-sm font-medium text-muted-foreground">
          Name
        </label>
        <textarea
          id={`${id}-name`}
          value={name}
          rows={1}
          maxLength={100}
          autoFocus
          aria-invalid={error === undefined ? undefined : true}
          aria-describedby={error === undefined ? undefined : `${id}-error`}
          onChange={(e) => {
            setName(e.target.value.replaceAll("\n", ""));
            setError(undefined);
          }}
          className="field-sizing-content sm:-mx-3 resize-none rounded-xl border border-input bg-background px-3 py-1.5 text-[2.25rem] leading-[1.1] font-semibold tracking-[-0.035em] outline-none focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring focus-visible:outline-solid aria-invalid:border-destructive lg:text-5xl dark:bg-input/20"
        />
        {error !== undefined && (
          <p id={`${id}-error`} className="text-sm font-medium text-destructive">
            {error}
          </p>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-description`} className="text-sm font-medium text-muted-foreground">
          Description <span className="font-normal">(optional)</span>
        </label>
        <textarea
          id={`${id}-description`}
          value={description}
          maxLength={1000}
          placeholder="What this deck is for"
          onChange={(e) => setDescription(e.target.value)}
          className={cn(
            FIELD,
            "field-sizing-content sm:-mx-3 h-auto min-h-24 max-w-prose resize-none border border-input px-3 py-2 text-[1.05rem] leading-relaxed outline-none focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring focus-visible:outline-solid lg:h-auto lg:px-3",
          )}
        />
      </div>
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
