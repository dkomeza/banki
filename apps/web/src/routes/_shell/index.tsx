import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useState } from "react";
import { Page } from "@/components/page";
import { PILL } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
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

// Variant e, "Stack" (builds on b, Shelf): every deck is drawn as what it is, a
// stack of paper cards, with only its name on the top card, so the wall reads
// at a glance; descriptions wait for the deck page. One toolbar under the
// title holds the sort, as a two-way switch, and "New deck", which opens b's
// dialog.

export const Route = createFileRoute("/_shell/")({
  component: Home,
});

function Home() {
  const state = useProtoState();
  const navigate = useNavigate();
  const all = useDecks();
  const [storedSort, setSort] = useDeckSort();
  const sort: DeckSort = state === "newest" ? "newest" : storedSort;
  const decks = state === "empty" ? [] : sortDecks(all, sort);
  const [creating, setCreating] = useState(state === "create" || state === "create-taken");

  return (
    <Page width="cards">
      <div className="flex flex-col gap-8 lg:gap-10">
        <header className="flex flex-col gap-6">
          <h1 className="text-[2.25rem] leading-none font-semibold tracking-[-0.035em] lg:text-5xl">
            Decks
          </h1>
          {decks.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-y py-3">
              <SortSwitch value={sort} onChange={setSort} />
              <Button className={cn(PILL, "h-11")} onClick={() => setCreating(true)}>
                <Plus aria-hidden />
                New deck
              </Button>
            </div>
          )}
        </header>

        {decks.length === 0 ? (
          <Empty onCreate={() => setCreating(true)} />
        ) : (
          <ul
            aria-label="Decks"
            className="grid grid-cols-2 gap-x-4 gap-y-7 pt-2 sm:gap-x-6 sm:gap-y-9 lg:grid-cols-3"
          >
            {decks.map((deck) => (
              <li key={deck.id} className="flex">
                <StackTile deck={deck} />
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

const SORTS: { value: DeckSort; label: string }[] = [
  { value: "alphabetical", label: "A–Z" },
  { value: "newest", label: "Newest" },
];

/** Alphabetical or Newest: two choices, so both stay in view. */
function SortSwitch({ value, onChange }: { value: DeckSort; onChange: (s: DeckSort) => void }) {
  return (
    <div role="radiogroup" aria-label="Sort decks" className="flex rounded-full border bg-card p-1">
      {SORTS.map((s) => (
        <button
          key={s.value}
          type="button"
          role="radio"
          aria-checked={value === s.value}
          aria-label={s.value === "alphabetical" ? "Alphabetical" : "Newest"}
          onClick={() => onChange(s.value)}
          className="h-9 min-w-20 rounded-full px-4 text-sm font-medium text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring focus-visible:outline-solid aria-checked:bg-foreground aria-checked:text-background motion-reduce:transition-none lg:h-8"
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}

/** A deck as a stack: the top card with its name, two more peeking out under it. */
function StackTile({ deck }: { deck: Deck }) {
  return (
    <Link
      to="/decks/$deckId"
      params={{ deckId: deck.id }}
      className="group relative isolate flex aspect-[4/3] w-full rounded-2xl lg:aspect-[16/10] text-card-foreground no-underline outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring focus-visible:outline-solid"
    >
      <span
        aria-hidden
        className="absolute inset-0 -z-20 translate-x-2 translate-y-2 rotate-[2.5deg] rounded-2xl border bg-muted transition-transform group-hover:translate-x-3 group-hover:rotate-[4deg] motion-reduce:transition-none"
      />
      <span
        aria-hidden
        className="absolute inset-0 -z-10 translate-x-1 translate-y-1 rotate-[1deg] rounded-2xl border bg-card transition-transform group-hover:translate-x-1.5 group-hover:rotate-[1.75deg] motion-reduce:transition-none"
      />
      <span className="flex w-full flex-col justify-between gap-2 rounded-2xl border bg-card p-4 transition-[border-color,translate] group-hover:-translate-y-1 group-hover:border-primary/50 motion-reduce:transition-none sm:p-5">
        {/* The ruled line an index card has under its heading. */}
        <span className="flex flex-col gap-2.5">
          <span className="line-clamp-3 text-[1.05rem] leading-snug font-semibold tracking-tight [overflow-wrap:anywhere] sm:text-lg">
            {deck.name}
          </span>
          <span aria-hidden className="h-px w-10 bg-primary/60" />
        </span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {createdLabel(deck.createdAt)}
        </span>
      </span>
    </Link>
  );
}

function Empty({ onCreate }: { onCreate: () => void }) {
  return (
    <section
      aria-labelledby="home-empty"
      className="flex flex-col items-center gap-6 px-4 py-12 text-center sm:py-16"
    >
      <div aria-hidden className="relative isolate h-28 w-36">
        <span className="absolute inset-0 -z-20 translate-x-2 translate-y-2 rotate-[4deg] rounded-xl border border-dashed border-input" />
        <span className="absolute inset-0 -z-10 translate-x-1 translate-y-1 rotate-[2deg] rounded-xl border border-dashed border-input" />
        <span className="absolute inset-0 flex items-center justify-center rounded-xl border border-dashed border-input bg-card">
          <Plus className="size-7 text-muted-foreground" />
        </span>
      </div>
      <div className="flex flex-col gap-2">
        <h2 id="home-empty" className="text-2xl font-semibold tracking-tight">
          No decks yet
        </h2>
        <p className="max-w-sm text-balance text-muted-foreground">
          A deck holds the cards for one thing you're learning. Make one, then add cards to it.
        </p>
      </div>
      <Button className={cn(PILL, "h-11")} onClick={onCreate}>
        <Plus aria-hidden />
        New deck
      </Button>
    </section>
  );
}
