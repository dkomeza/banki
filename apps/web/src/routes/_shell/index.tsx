import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Page } from "@/components/page";
import { OUTLINE_PILL, PILL } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import { DeckFields } from "@/proto/deck-fields";
import {
  type Deck,
  type DeckSort,
  NAME_TAKEN,
  createDeck,
  sortDecks,
  useDeckSort,
  useDecks,
  useProtoState,
} from "@/proto/decks";
import { SortMenu } from "@/proto/sort-menu";

// Variant c, "Index": Home reads like a book's index. The decks are grouped
// under the letter they start with (Alphabetical) or the month they were made
// (Newest), one card per group, names only, so a long shelf stays scannable.
// The sort is a quiet menu, and "New deck" opens its form in place above the
// groups.

export const Route = createFileRoute("/_shell/")({
  component: Home,
});

type Group = { key: string; label: string; decks: Deck[] };

const month = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" });

function groups(decks: Deck[], sort: DeckSort): Group[] {
  const out: Group[] = [];
  for (const deck of decks) {
    const label =
      sort === "newest"
        ? month.format(deck.createdAt)
        : /\p{L}/u.test(deck.name[0] ?? "")
          ? (deck.name[0] ?? "").toLocaleUpperCase()
          : "#";
    const last = out.at(-1);
    if (last?.label === label) last.decks.push(deck);
    else out.push({ key: label, label, decks: [deck] });
  }
  return out;
}

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
        <h1 className="text-[2.25rem] leading-none font-semibold tracking-[-0.035em] lg:text-5xl">
          Home
        </h1>

        {creating ? (
          <CreateForm taken={state === "create-taken"} onCancel={() => setCreating(false)} />
        ) : decks.length > 0 ? (
          <div className="flex items-center justify-between gap-3 border-b pb-3">
            <Button className={PILL} onClick={() => setCreating(true)}>
              <Plus aria-hidden />
              New deck
            </Button>
            <SortMenu value={sort} onChange={setSort} />
          </div>
        ) : null}

        {decks.length === 0 && !creating ? (
          <Empty onCreate={() => setCreating(true)} />
        ) : (
          <div className="flex flex-col gap-5">
            {groups(decks, sort).map((g) => (
              <section
                key={g.key}
                aria-labelledby={`group-${g.key}`}
                className="grid grid-cols-[2.75rem_1fr] gap-x-3 sm:grid-cols-[4rem_1fr] sm:gap-x-4"
              >
                <h2
                  id={`group-${g.key}`}
                  className={
                    sort === "newest"
                      ? "col-span-2 pb-2 text-sm font-semibold tracking-wide text-muted-foreground uppercase"
                      : "pt-3 text-right text-3xl leading-none font-semibold tracking-tight text-primary sm:text-4xl"
                  }
                >
                  {g.label}
                </h2>
                <ul
                  className={
                    sort === "newest"
                      ? "col-span-2 divide-y overflow-hidden rounded-[1.25rem] border bg-card"
                      : "divide-y overflow-hidden rounded-[1.25rem] border bg-card"
                  }
                >
                  {g.decks.map((deck) => (
                    <li key={deck.id}>
                      <Link
                        to="/decks/$deckId"
                        params={{ deckId: deck.id }}
                        className="flex min-h-13 items-center px-5 py-3 text-[1.05rem] leading-snug font-medium text-foreground no-underline transition-colors outline-none [overflow-wrap:anywhere] hover:bg-muted hover:text-primary focus-visible:-outline-offset-2"
                      >
                        {deck.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </Page>
  );
}

function CreateForm({ taken, onCancel }: { taken: boolean; onCancel: () => void }) {
  const navigate = useNavigate();
  const [name, setName] = useState(taken ? "calculus 2" : "");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | undefined>(taken ? NAME_TAKEN : undefined);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const result = createDeck(name, description);
    if (result.ok) void navigate({ to: "/decks/$deckId", params: { deckId: result.id } });
    else setError(result.error);
  };

  return (
    <form
      onSubmit={submit}
      aria-labelledby="new-deck-title"
      className="flex flex-col gap-5 rounded-[1.25rem] border bg-card p-5 sm:p-6"
    >
      <h2 id="new-deck-title" className="text-xl font-semibold tracking-tight">
        New deck
      </h2>
      <div className="rounded-xl bg-muted p-4 sm:p-5">
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
      </div>
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
      className="grid grid-cols-[2.75rem_1fr] gap-x-3 sm:grid-cols-[4rem_1fr] sm:gap-x-4"
    >
      <span
        aria-hidden
        className="pt-5 text-right text-3xl leading-none font-semibold tracking-tight text-input sm:text-4xl"
      >
        A
      </span>
      <div className="flex flex-col items-start gap-4 rounded-[1.25rem] border border-dashed border-input/70 p-6">
        <div className="flex flex-col gap-1.5">
          <h2 id="home-empty" className="text-lg font-semibold tracking-tight">
            Nothing here yet
          </h2>
          <p className="text-sm text-balance text-muted-foreground">
            Your decks will be listed here from A to Z. Make one for each thing you're learning.
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
