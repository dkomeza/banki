import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { ChevronRight, Plus } from "lucide-react";
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

// Variant g, "Open shelf" (builds on b, Shelf): b's tiles, quieter and wider,
// two to a row, each a flat card with the deck's name, the start of its
// description and a footer line, without b's peeking second card or dashed
// "New deck" tile. The sort and "New deck" stay in the header; create opens
// b's dialog.

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
          <ul aria-label="Decks" className="grid gap-3 md:grid-cols-2 md:gap-4">
            {decks.map((deck) => (
              <li key={deck.id} className="flex">
                <Tile deck={deck} />
              </li>
            ))}
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
      className="group flex w-full flex-col gap-2 rounded-[1.25rem] border bg-card p-5 text-card-foreground no-underline transition-colors outline-none hover:border-foreground/30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid motion-reduce:transition-none sm:p-6"
    >
      <span className="line-clamp-2 text-xl leading-snug font-semibold tracking-tight [overflow-wrap:anywhere]">
        {deck.name}
      </span>
      {deck.description !== null && (
        <span className="line-clamp-2 text-[0.95rem] leading-relaxed text-muted-foreground">
          {deck.description}
        </span>
      )}
      <span className="mt-auto flex items-center justify-between gap-3 border-t pt-3 text-sm text-muted-foreground tabular-nums">
        <span>0 cards · Created {createdLabel(deck.createdAt)}</span>
        <ChevronRight
          aria-hidden
          className="size-4 transition-transform group-hover:translate-x-0.5 group-hover:text-primary motion-reduce:transition-none"
        />
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
