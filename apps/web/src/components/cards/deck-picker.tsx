// Variant a: the destination picker, a sibling of the Move deck picker: the
// same sheet, the same list, Folders as headings and each Deck with its cover.
import { Dialog } from "@base-ui/react/dialog";
import { Check, CornerDownRight, Folder as FolderIcon, X } from "lucide-react";
import { useState } from "react";
import { FormError } from "@/components/auth-card";
import { Cover } from "@/components/decks/cover";
import { OUTLINE_PILL, PILL } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import type { Card } from "@/lib/cards";
import type { Deck } from "@/lib/decks";
import type { Library } from "@/lib/folders";
import { cn } from "@/lib/utils";
import { deckRows } from "./proto-move";

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
  const rows = deckRows(library);
  const [picked, setPicked] = useState<Deck>();
  const one = cards.length === 1 ? cards[0] : undefined;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <Dialog.Title className="text-2xl font-semibold tracking-tight">
            {one === undefined ? `Move ${cards.length} cards` : "Move card"}
          </Dialog.Title>
          <Dialog.Description className="line-clamp-2 text-[0.95rem] text-muted-foreground [overflow-wrap:anywhere]">
            {one === undefined
              ? `Which deck should they go to? They keep their tags and history.`
              : `Which deck should “${one.front}” go to?`}
          </Dialog.Description>
        </div>
        <Dialog.Close
          render={<Button variant="ghost" size="icon" className="-mt-1.5 -mr-2 rounded-full" />}
          aria-label="Close"
        >
          <X aria-hidden />
        </Dialog.Close>
      </div>
      <ul
        role="listbox"
        aria-label="Decks"
        className="-mx-2 flex max-h-[min(24rem,50svh)] flex-col gap-0.5 overflow-y-auto rounded-xl border bg-background p-1.5 dark:bg-input/10"
      >
        {rows.map((row) => {
          const pad = { paddingLeft: `${0.75 + row.depth * 1.25}rem` };
          if (row.kind === "folder") {
            return (
              <li
                key={row.id}
                role="presentation"
                style={pad}
                className="flex min-h-9 items-center gap-2.5 pt-1.5 pr-3 text-xs font-semibold tracking-[0.06em] text-muted-foreground uppercase"
              >
                <FolderIcon aria-hidden className="size-3.5 shrink-0" />
                <span className="min-w-0 truncate">{row.name}</span>
              </li>
            );
          }
          const here = row.deck.id === from.id;
          const selected = picked?.id === row.deck.id;
          return (
            <li key={row.deck.id}>
              <button
                type="button"
                role="option"
                aria-selected={selected}
                aria-disabled={here}
                disabled={here}
                onClick={() => setPicked(row.deck)}
                style={pad}
                className="flex min-h-11 w-full items-center gap-2.5 rounded-lg pr-3 text-left text-[0.95rem] outline-none hover:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid disabled:cursor-not-allowed disabled:text-muted-foreground disabled:hover:bg-transparent aria-selected:bg-accent aria-selected:font-medium lg:min-h-9"
              >
                <Cover
                  name={row.deck.name}
                  className="h-5 w-6 shrink-0 rounded-[0.3rem] border text-[0.55rem] [&>span:first-child]:left-1.5 [&>span:last-child]:pl-2"
                />
                <span className="min-w-0 flex-1 truncate">{row.deck.name}</span>
                {here && <span className="shrink-0 text-xs text-muted-foreground">Here now</span>}
                {selected && <Check aria-hidden className="size-4 shrink-0 text-primary" />}
              </button>
            </li>
          );
        })}
      </ul>
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
