import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useState } from "react";
import { Page } from "@/components/page";
import { PILL } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Cover, Stack } from "@/proto/cover";
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

// Variant j, "Spine" (builds on e, Stack, with f's covers): every deck is a
// wide paper stack, two to a row, and its top card reads like a book: the
// cover at its left edge, then the name and the first lines of the
// description. One toolbar under the title holds the sort, as a two-way
// switch, and "New deck", which opens b's dialog.

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
            className="grid grid-cols-1 gap-x-6 gap-y-6 pt-2 sm:gap-y-8 md:grid-cols-2"
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

/**
 * A deck as a wide stack, lying on its side. The top card has the cover at its
 * left edge, f's monogram on ruled paper, and beside it the name and the first
 * lines of the description, so a deck reads like a book's spine and blurb.
 */
function StackTile({ deck }: { deck: Deck }) {
  return (
    <Link
      to="/decks/$deckId"
      params={{ deckId: deck.id }}
      className="group flex w-full rounded-2xl text-card-foreground no-underline outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring focus-visible:outline-solid"
    >
      <Stack className="w-full">
        <span className="flex w-full overflow-hidden rounded-2xl border bg-card transition-[border-color,translate] group-hover:-translate-y-1 group-hover:border-primary/50 motion-reduce:transition-none">
          <Cover
            name={deck.name}
            className="w-24 shrink-0 self-stretch border-r text-3xl [&>span:first-child]:left-3 [&>span:last-child]:pl-5 sm:w-32 sm:text-4xl"
          />
          <span className="flex min-h-36 min-w-0 flex-1 flex-col gap-1.5 p-4 sm:p-5">
            <span className="line-clamp-2 leading-snug font-semibold tracking-tight [overflow-wrap:anywhere] sm:text-[1.05rem]">
              {deck.name}
            </span>
            {deck.description !== null && (
              <span className="line-clamp-2 text-sm leading-relaxed text-muted-foreground">
                {deck.description}
              </span>
            )}
            <span className="mt-auto pt-2 text-xs text-muted-foreground tabular-nums">
              Created {createdLabel(deck.createdAt)}
            </span>
          </span>
        </span>
      </Stack>
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
