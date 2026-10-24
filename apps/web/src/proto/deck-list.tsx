// PROTOTYPE (BAN-11): Variant d's deck list, the desk's left-hand pile. Home
// shows it on its own; the deck page keeps it beside the deck from 1024 px.
import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronDown, Plus } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { FIELD, PILL } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  type Deck,
  type DeckSort,
  NAME_TAKEN,
  createDeck,
  createdLabel,
  sortDecks,
  useDeckSort,
  useDecks,
} from "@/proto/decks";
import { SortMenu } from "@/proto/sort-menu";

export function DeckList({
  currentId,
  state,
  compact = false,
}: {
  currentId?: string;
  state?: string | undefined;
  compact?: boolean;
}) {
  const all = useDecks();
  const [storedSort, setSort] = useDeckSort();
  const sort: DeckSort = state === "newest" ? "newest" : storedSort;
  const decks = state === "empty" ? [] : sortDecks(all, sort);

  return (
    <section
      aria-labelledby="decks-title"
      className="flex flex-col overflow-hidden rounded-[1.25rem] border bg-card text-card-foreground"
    >
      <div className="flex items-center justify-between gap-3 border-b py-2 pr-2 pl-5">
        <h2 id="decks-title" className="text-sm font-semibold">
          Decks{" "}
          <span className="font-normal text-muted-foreground tabular-nums">{decks.length}</span>
        </h2>
        {decks.length > 0 && <SortMenu value={sort} onChange={setSort} />}
      </div>
      {!compact && (
        <QuickAdd
          key={state}
          open={state === "create" || state === "create-taken"}
          taken={state === "create-taken"}
        />
      )}
      {decks.length === 0 ? (
        <div className="flex flex-col gap-1.5 px-5 py-10 text-center">
          <p className="font-medium">No decks yet</p>
          <p className="mx-auto max-w-xs text-sm text-balance text-muted-foreground">
            Name your first deck above. You can add a description now or later.
          </p>
        </div>
      ) : (
        <ul className={cn("divide-y", compact && "max-h-[calc(100svh-16rem)] overflow-y-auto")}>
          {decks.map((deck) => (
            <li key={deck.id}>
              <Row deck={deck} current={deck.id === currentId} compact={compact} />
            </li>
          ))}
        </ul>
      )}
      {compact && (
        <Link
          to="/"
          search={{ state: "create" }}
          className="flex h-12 items-center gap-2 border-t px-5 text-sm font-medium text-muted-foreground no-underline hover:bg-muted hover:text-foreground"
        >
          <Plus aria-hidden className="size-4" />
          New deck
        </Link>
      )}
    </section>
  );
}

function Row({ deck, current, compact }: { deck: Deck; current: boolean; compact: boolean }) {
  return (
    <Link
      to="/decks/$deckId"
      params={{ deckId: deck.id }}
      aria-current={current ? "page" : undefined}
      className={cn(
        "relative flex flex-col gap-0.5 px-5 py-3 text-foreground no-underline transition-colors outline-none hover:bg-muted focus-visible:-outline-offset-2 aria-[current=page]:bg-accent",
        "before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-r-full before:bg-primary before:opacity-0 aria-[current=page]:before:opacity-100",
        compact ? "min-h-12" : "min-h-16",
      )}
    >
      <span
        className={cn(
          "leading-snug font-medium [overflow-wrap:anywhere]",
          compact ? "line-clamp-2 text-[0.95rem]" : "text-[1.05rem]",
        )}
      >
        {deck.name}
      </span>
      {!compact && (
        <span className="flex gap-2 text-sm text-muted-foreground">
          <span className="shrink-0 tabular-nums">{createdLabel(deck.createdAt)}</span>
          {deck.description !== null && (
            <>
              <span aria-hidden>·</span>
              <span className="truncate">{deck.description.split("\n")[0]}</span>
            </>
          )}
        </span>
      )}
    </Link>
  );
}

/** The always-there "New deck" row: type a name and press Enter; a description is one tap away. */
function QuickAdd({ open, taken }: { open: boolean; taken: boolean }) {
  const navigate = useNavigate();
  const id = useId();
  const [name, setName] = useState(taken ? "calculus 2" : "");
  const [description, setDescription] = useState("");
  const [withDescription, setWithDescription] = useState(open);
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
      aria-label="New deck"
      className={cn(
        "flex flex-col gap-3 border-b p-3 sm:p-4",
        (open || withDescription) && "bg-muted",
      )}
    >
      <label htmlFor={id} className="sr-only">
        New deck name
      </label>
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Plus
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            id={id}
            value={name}
            maxLength={100}
            autoComplete="off"
            autoFocus={open}
            placeholder="New deck name"
            aria-invalid={error === undefined ? undefined : true}
            aria-describedby={error === undefined ? undefined : `${id}-error`}
            onChange={(e) => {
              setName(e.target.value);
              setError(undefined);
            }}
            className={cn(FIELD, "pl-10 lg:pl-10")}
          />
        </div>
        <Button type="submit" className={cn(PILL, "h-12 lg:h-11")} disabled={name.trim() === ""}>
          Create
        </Button>
      </div>
      {error !== undefined && (
        <p id={`${id}-error`} className="px-1 text-sm font-medium text-destructive">
          {error}
        </p>
      )}
      {withDescription ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-description`} className="px-1 text-sm font-medium">
            Description <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <textarea
            id={`${id}-description`}
            rows={3}
            maxLength={1000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className={cn(
              FIELD,
              "h-auto min-h-20 resize-y border border-input py-3 leading-relaxed outline-none focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring focus-visible:outline-solid lg:h-auto",
            )}
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setWithDescription(true)}
          className="inline-flex h-9 w-fit items-center gap-1 rounded-full px-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronDown aria-hidden className="size-4" />
          Add a description
        </button>
      )}
    </form>
  );
}
