// Variant b: the destination picker, a sibling of the Move deck picker, made
// a searchable combobox as docs/design.md asks of pickers: typing narrows the
// Decks to a flat list with where each one is; arrows and Enter pick.
import { Dialog } from "@base-ui/react/dialog";
import { Check, CornerDownRight, Folder as FolderIcon, Search, X } from "lucide-react";
import { type KeyboardEvent, useId, useState } from "react";
import { FormError } from "@/components/auth-card";
import { OUTLINE_PILL, PILL } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import type { Card } from "@/lib/cards";
import type { Deck } from "@/lib/decks";
import type { Library } from "@/lib/folders";
import { cn } from "@/lib/utils";
import { type DeckRow, deckRows } from "./proto-move";

const BACKDROP =
  "fixed inset-0 z-40 bg-foreground/30 backdrop-blur-[2px] transition-opacity data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 motion-reduce:transition-none dark:bg-black/50";
const SHEET =
  "fixed inset-x-0 bottom-0 z-50 flex max-h-[92svh] flex-col gap-5 overflow-y-auto rounded-t-[1.5rem] border bg-card p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] text-card-foreground shadow-xl transition-[opacity,translate] data-[ending-style]:translate-y-8 data-[ending-style]:opacity-0 data-[starting-style]:translate-y-8 data-[starting-style]:opacity-0 motion-reduce:transition-none sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:w-[min(32rem,calc(100vw-3rem))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[1.25rem] sm:pb-6";

/** The picker for `cards`, out of `from`; picking a Deck and Move sends them there. */
export function DeckPicker({
  library,
  from,
  cards,
  error,
  onMove,
  onClose,
}: {
  library: Library;
  from: Deck;
  cards: readonly Card[] | undefined;
  error: string | undefined;
  onMove: (to: Deck) => void;
  onClose: () => void;
}) {
  return (
    <Dialog.Root open={cards !== undefined} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className={BACKDROP} />
        <Dialog.Popup className={SHEET}>
          {cards !== undefined && (
            <Body
              library={library}
              from={from}
              cards={cards}
              error={error}
              onMove={onMove}
              onClose={onClose}
            />
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Body({
  library,
  from,
  cards,
  error,
  onMove,
  onClose,
}: {
  library: Library;
  from: Deck;
  cards: readonly Card[];
  error: string | undefined;
  onMove: (to: Deck) => void;
  onClose: () => void;
}) {
  const listId = useId();
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Deck>();
  const [cursor, setCursor] = useState<string>();
  const words = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const all = deckRows(library);
  // Searching drops the Folders' headings: each Deck says where it is instead.
  const rows: DeckRow[] =
    words.length === 0
      ? all
      : all.filter(
          (row) =>
            row.kind === "deck" &&
            words.every((w) => `${row.deck.name} ${row.path}`.toLocaleLowerCase().includes(w)),
        );
  const pickable = rows.flatMap((row) =>
    row.kind === "deck" && row.deck.id !== from.id ? [row.deck] : [],
  );
  const one = cards.length === 1 ? cards[0] : undefined;

  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const at = pickable.findIndex((d) => d.id === cursor);
      const step = event.key === "ArrowDown" ? 1 : -1;
      const next = pickable[(at + step + pickable.length) % pickable.length];
      if (next !== undefined) setCursor(next.id);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const deck =
        pickable.find((d) => d.id === cursor) ?? (pickable.length === 1 ? pickable[0] : undefined);
      if (deck === undefined) return;
      if (picked?.id === deck.id) onMove(deck);
      else setPicked(deck);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <Dialog.Title className="text-2xl font-semibold tracking-tight">
            {one === undefined ? `Move ${cards.length} cards` : "Move card"}
          </Dialog.Title>
          <Dialog.Description className="line-clamp-2 text-[0.95rem] text-muted-foreground [overflow-wrap:anywhere]">
            {one === undefined ? "Where should they go?" : <>Where should “{one.front}” go?</>}
          </Dialog.Description>
        </div>
        <Dialog.Close
          render={<Button variant="ghost" size="icon" className="-mt-1.5 -mr-2 rounded-full" />}
          aria-label="Close"
        >
          <X aria-hidden />
        </Dialog.Close>
      </div>
      <div className="-mx-2 flex flex-col overflow-hidden rounded-xl border bg-background dark:bg-input/10">
        <div className="relative border-b">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <input
            role="combobox"
            aria-expanded
            aria-controls={listId}
            aria-activedescendant={cursor === undefined ? undefined : `${listId}-${cursor}`}
            aria-label="Find a deck"
            placeholder="Find a deck"
            autoComplete="off"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setCursor(undefined);
            }}
            onKeyDown={onKey}
            className="h-12 w-full bg-transparent pr-3 pl-10 text-base outline-none placeholder:text-muted-foreground lg:h-11 lg:text-sm"
          />
        </div>
        <ul
          id={listId}
          role="listbox"
          aria-label="Decks"
          className="flex h-[min(20rem,42svh)] flex-col gap-0.5 overflow-y-auto p-1.5"
        >
          {rows.length === 0 && (
            <li role="presentation" className="px-3 py-6 text-center text-sm text-muted-foreground">
              No deck is called that.
            </li>
          )}
          {rows.map((row) => {
            const pad = { paddingLeft: `${0.75 + (words.length > 0 ? 0 : row.depth) * 1.25}rem` };
            if (row.kind === "folder") {
              return (
                <li
                  key={row.id}
                  role="presentation"
                  style={pad}
                  className="flex min-h-9 items-center gap-2 pt-1.5 pr-3 text-sm text-muted-foreground"
                >
                  <FolderIcon aria-hidden className="size-4 shrink-0" />
                  <span className="min-w-0 truncate">{row.name}</span>
                </li>
              );
            }
            const here = row.deck.id === from.id;
            const selected = picked?.id === row.deck.id;
            return (
              <li
                key={row.deck.id}
                id={`${listId}-${row.deck.id}`}
                role="option"
                aria-selected={selected}
                aria-disabled={here}
                onClick={() => !here && setPicked(row.deck)}
                style={pad}
                className={cn(
                  "flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg py-1.5 pr-3 text-[0.95rem] hover:bg-muted aria-selected:bg-accent aria-selected:font-medium lg:min-h-9",
                  cursor === row.deck.id &&
                    "outline-2 -outline-offset-2 outline-ring outline-solid",
                  here && "cursor-not-allowed text-muted-foreground hover:bg-transparent",
                )}
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{row.deck.name}</span>
                  {words.length > 0 && (
                    <span className="truncate text-xs font-normal text-muted-foreground">
                      {row.path === "" ? "Decks" : `Decks › ${row.path}`}
                    </span>
                  )}
                </span>
                {here && <span className="shrink-0 text-xs text-muted-foreground">Here now</span>}
                {selected && <Check aria-hidden className="size-4 shrink-0 text-primary" />}
              </li>
            );
          })}
        </ul>
      </div>
      {error !== undefined && <FormError>{error}</FormError>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
        <Button type="button" variant="outline" className={OUTLINE_PILL} onClick={onClose}>
          Cancel
        </Button>
        <Button
          className={cn(PILL, "min-w-0")}
          disabled={picked === undefined}
          onClick={() => picked !== undefined && onMove(picked)}
        >
          <CornerDownRight aria-hidden />
          <span className="truncate">
            {picked === undefined ? "Move" : `Move to ${picked.name}`}
          </span>
        </Button>
      </div>
    </div>
  );
}
