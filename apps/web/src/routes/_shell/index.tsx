import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { ChevronRight, Plus } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Page } from "@/components/page";
import { OUTLINE_PILL, PILL } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { DeckFields } from "@/proto/deck-fields";
import {
  type DeckSort,
  createDeck,
  createdLabel,
  sortDecks,
  useDeckSort,
  useDecks,
  useProtoState,
} from "@/proto/decks";

// Variant a, "Ledger": Home is one card of dense rows, the sort a segmented
// switch above it, and "New deck" opens its form in place at the top of the card.

export const Route = createFileRoute("/_shell/")({
  component: Home,
});

function Home() {
  const state = useProtoState();
  const all = useDecks();
  const [storedSort, setSort] = useDeckSort();
  const sort: DeckSort = state === "newest" ? "newest" : storedSort;
  const decks = state === "empty" ? [] : sortDecks(all, sort);
  const [creating, setCreating] = useState(state === "create" || state === "create-taken");

  return (
    <Page width="reading">
      <div className="flex flex-col gap-6 lg:gap-8">
        <div className="flex items-end justify-between gap-4">
          <div className="flex flex-col gap-2">
            <h1 className="text-[2.25rem] leading-none font-semibold tracking-[-0.035em] lg:text-5xl">
              Home
            </h1>
            {decks.length > 0 && (
              <p className="text-muted-foreground">
                {decks.length} {decks.length === 1 ? "deck" : "decks"}
              </p>
            )}
          </div>
          {decks.length > 0 && !creating && (
            <Button className={PILL} onClick={() => setCreating(true)}>
              <Plus aria-hidden />
              New deck
            </Button>
          )}
        </div>

        {decks.length === 0 && !creating ? (
          <Empty onCreate={() => setCreating(true)} />
        ) : (
          <div className="flex flex-col gap-3">
            {decks.length > 0 && <SortSwitch value={sort} onChange={setSort} />}
            <section
              aria-label="Decks"
              className="overflow-hidden rounded-[1.25rem] border bg-card text-card-foreground"
            >
              {creating && (
                <CreateForm taken={state === "create-taken"} onCancel={() => setCreating(false)} />
              )}
              <ul className="divide-y">
                {decks.map((deck) => (
                  <li key={deck.id}>
                    <Link
                      to="/decks/$deckId"
                      params={{ deckId: deck.id }}
                      className="group flex min-h-16 items-center gap-4 px-5 py-3.5 text-foreground no-underline transition-colors outline-none hover:bg-muted focus-visible:-outline-offset-2 sm:px-6"
                    >
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="text-[1.05rem] leading-snug font-medium [overflow-wrap:anywhere]">
                          {deck.name}
                        </span>
                        {deck.description !== null && (
                          <span className="truncate text-sm text-muted-foreground">
                            {deck.description.split("\n")[0]}
                          </span>
                        )}
                      </div>
                      <span className="hidden shrink-0 text-sm text-muted-foreground tabular-nums sm:block">
                        {createdLabel(deck.createdAt)}
                      </span>
                      <ChevronRight
                        aria-hidden
                        className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        )}
      </div>
    </Page>
  );
}

function SortSwitch({ value, onChange }: { value: DeckSort; onChange: (s: DeckSort) => void }) {
  const options: { value: DeckSort; label: string }[] = [
    { value: "alphabetical", label: "Alphabetical" },
    { value: "newest", label: "Newest" },
  ];
  return (
    <div className="flex items-center gap-3">
      <span id="sort-label" className="text-sm text-muted-foreground">
        Sort
      </span>
      <div
        role="radiogroup"
        aria-labelledby="sort-label"
        className="inline-flex rounded-full border bg-card p-0.5"
      >
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            onClick={() => onChange(o.value)}
            className="h-10 rounded-full px-4 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground aria-checked:bg-primary aria-checked:text-primary-foreground lg:h-8 lg:px-3.5"
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function CreateForm({ taken, onCancel }: { taken: boolean; onCancel: () => void }) {
  const navigate = useNavigate();
  const [name, setName] = useState(taken ? "calculus 2" : "");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | undefined>(
    taken ? "You already have a deck with this name." : undefined,
  );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const result = createDeck(name, description);
    if (result.ok) void navigate({ to: "/decks/$deckId", params: { deckId: result.id } });
    else setError(result.error);
  };

  return (
    <form
      onSubmit={submit}
      aria-label="New deck"
      className="flex flex-col gap-5 border-b bg-muted p-5 sm:p-6"
    >
      <h2 className="text-xl font-semibold tracking-tight">New deck</h2>
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
        rows={3}
      />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" className={PILL}>
          Create deck
        </Button>
        <Button type="button" variant="outline" className={OUTLINE_PILL} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function Empty({ onCreate }: { onCreate: () => void }) {
  return (
    <section
      aria-labelledby="home-empty"
      className="flex flex-col items-center gap-5 rounded-[1.25rem] border border-dashed border-input/60 px-6 py-14 text-center"
    >
      <EmptyStack />
      <div className="flex max-w-xs flex-col gap-1.5">
        <h2 id="home-empty" className="text-lg font-semibold tracking-tight">
          Your decks will live here
        </h2>
        <p className="text-sm text-balance text-muted-foreground">
          Make a deck for each thing you're learning, then fill it with cards.
        </p>
      </div>
      <Button className={cn(PILL)} onClick={onCreate}>
        <Plus aria-hidden />
        Create your first deck
      </Button>
    </section>
  );
}

/** Three blank cards, the logo's stack drawn as outlines: nothing in it yet. */
function EmptyStack() {
  return (
    <div aria-hidden className="relative h-20 w-28">
      <div className="absolute top-0 left-6 h-14 w-20 rotate-9 rounded-lg border-2 border-input/50 bg-card" />
      <div className="absolute top-2.5 left-3.5 h-14 w-20 rotate-2 rounded-lg border-2 border-input/70 bg-card" />
      <div className="absolute top-5 left-1 h-14 w-20 -rotate-5 rounded-lg border-2 border-primary/70 bg-card" />
    </div>
  );
}
