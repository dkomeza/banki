import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useCallback, useState } from "react";
import { Page } from "@/components/page";
import { Combobox } from "@/components/settings/combobox";
import { PILL } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import { DeckDialog } from "@/proto/deck-dialog";
import {
  type Deck,
  type DeckSort,
  NAME_TAKEN,
  createDeck,
  createdLabel,
  sortDecks,
  useDeckSort,
  useDecks,
  useProtoState,
} from "@/proto/decks";

// Variant b, "Shelf": Home is a wall of deck tiles, two or three to a row, each
// showing its name and the start of its description. The sort is the usual
// picker in the page's header, and "New deck" opens its form in a dialog (a
// sheet on phones), as Edit does on the deck page.

export const Route = createFileRoute("/_shell/")({
  component: Home,
});

const SORTS = [
  { value: "alphabetical", label: "Alphabetical" },
  { value: "newest", label: "Newest" },
] as const;

function Home() {
  const state = useProtoState();
  const navigate = useNavigate();
  const all = useDecks();
  const [storedSort, setSort] = useDeckSort();
  const sort: DeckSort = state === "newest" ? "newest" : storedSort;
  const decks = state === "empty" ? [] : sortDecks(all, sort);
  const [creating, setCreating] = useState(state === "create" || state === "create-taken");
  const search = useCallback(
    (query: string) =>
      SORTS.filter((o) => o.label.toLowerCase().includes(query.trim().toLowerCase())),
    [],
  );

  return (
    <Page width="cards">
      <div className="flex flex-col gap-8 lg:gap-10">
        <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-col gap-2">
            <h1 className="text-[2.25rem] leading-none font-semibold tracking-[-0.035em] lg:text-5xl">
              Your decks
            </h1>
            {decks.length > 0 && (
              <p className="text-muted-foreground">
                {decks.length} {decks.length === 1 ? "deck" : "decks"}
              </p>
            )}
          </div>
          {decks.length > 0 && (
            <div className="flex items-end gap-3">
              <div className="flex w-44 flex-col gap-1.5">
                <span id="sort-label" className="text-sm font-medium text-muted-foreground">
                  Sort by
                </span>
                <Combobox
                  options={SORTS}
                  value={sort}
                  onPick={(v) => setSort(v === "newest" ? "newest" : "alphabetical")}
                  search={search}
                  labelledBy="sort-label"
                  placeholder="Sort"
                  searchPlaceholder="Sort by…"
                  noMatch={(q) => `No sort matches “${q}”.`}
                  chevron
                />
              </div>
              <Button className={`${PILL} h-12 lg:h-11`} onClick={() => setCreating(true)}>
                <Plus aria-hidden />
                New deck
              </Button>
            </div>
          )}
        </header>

        {decks.length === 0 ? (
          <Empty onCreate={() => setCreating(true)} />
        ) : (
          <ul aria-label="Decks" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {decks.map((deck) => (
              <li key={deck.id} className="isolate flex">
                <Tile deck={deck} />
              </li>
            ))}
            <li className="flex">
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="flex min-h-40 w-full flex-col items-center justify-center gap-2 rounded-[1.25rem] border-2 border-dashed border-input/60 text-muted-foreground transition-colors outline-none hover:border-primary/60 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid"
              >
                <Plus aria-hidden className="size-6" />
                <span className="font-medium">New deck</span>
              </button>
            </li>
          </ul>
        )}
      </div>

      <DeckDialog
        open={creating}
        onOpenChange={setCreating}
        title="New deck"
        submitLabel="Create deck"
        initial={{ name: state === "create-taken" ? "calculus 2" : "", description: "" }}
        initialError={state === "create-taken" ? NAME_TAKEN : undefined}
        onSubmit={(name, description) => {
          const result = createDeck(name, description);
          if (result.ok) void navigate({ to: "/decks/$deckId", params: { deckId: result.id } });
          return result;
        }}
      />
    </Page>
  );
}

function Tile({ deck }: { deck: Deck }) {
  return (
    <Link
      to="/decks/$deckId"
      params={{ deckId: deck.id }}
      className="group relative flex min-h-40 w-full flex-col gap-3 rounded-[1.25rem] border bg-card p-5 text-card-foreground no-underline transition-[border-color,translate,box-shadow] outline-none hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid motion-reduce:transition-none motion-reduce:hover:translate-y-0 sm:p-6"
    >
      {/* The tile's edge: a second card peeking out under it, like a deck. */}
      <span
        aria-hidden
        className="absolute inset-x-4 -bottom-1.5 -z-10 h-4 rounded-b-[1rem] border border-t-0 bg-card"
      />
      <span className="line-clamp-3 text-lg leading-snug font-semibold tracking-tight [overflow-wrap:anywhere]">
        {deck.name}
      </span>
      {deck.description !== null ? (
        <span className="line-clamp-3 text-sm leading-relaxed whitespace-pre-line text-muted-foreground">
          {deck.description}
        </span>
      ) : (
        <span className="text-sm text-muted-foreground/70 italic">No description</span>
      )}
      <span className="mt-auto pt-2 text-xs text-muted-foreground tabular-nums">
        Created {createdLabel(deck.createdAt)}
      </span>
    </Link>
  );
}

function Empty({ onCreate }: { onCreate: () => void }) {
  return (
    <section
      aria-labelledby="home-empty"
      className="grid items-center gap-8 rounded-[1.5rem] border bg-card p-8 sm:grid-cols-[auto_1fr] sm:p-10"
    >
      <div aria-hidden className="grid w-fit grid-cols-2 gap-2.5 sm:gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className={
              i === 0
                ? "h-16 w-20 rounded-xl border-2 border-primary/70 bg-accent"
                : "h-16 w-20 rounded-xl border-2 border-dashed border-input/60"
            }
          />
        ))}
      </div>
      <div className="flex flex-col items-start gap-4">
        <div className="flex flex-col gap-1.5">
          <h2 id="home-empty" className="text-2xl font-semibold tracking-tight">
            No decks yet
          </h2>
          <p className="max-w-sm text-balance text-muted-foreground">
            A deck holds the cards for one thing you're learning. Start with one, and add cards to
            it next.
          </p>
        </div>
        <Button className={PILL} onClick={onCreate}>
          <Plus aria-hidden />
          Create your first deck
        </Button>
      </div>
    </section>
  );
}
