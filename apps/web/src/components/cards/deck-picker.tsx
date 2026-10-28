// The destination picker of a Move of Cards, a sibling of the Move deck
// picker: the same sheet and list, every live Deck under its Folders, the
// Folders as headings that can't be picked, each Deck with its cover.
import { Dialog } from "@base-ui/react/dialog";
import { Check, CornerDownRight, Folder as FolderIcon } from "lucide-react";
import { useState } from "react";
import { FormError } from "@/components/auth-card";
import { Cover } from "@/components/decks/cover";
import { BACKDROP, Head, SHEET } from "@/components/folders/dialogs";
import { OUTLINE_PILL, PILL } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import type { Card } from "@/lib/cards";
import type { Deck } from "@/lib/decks";
import { type Library, deckRows } from "@/lib/folders";
import { firstLine } from "@/lib/deletions";
import { cn } from "@/lib/utils";

/**
 * The picker for `cards`, out of the Deck `from`, open while there are Cards
 * to move. `from` shows "Here now" and can't be picked. Picking a Deck and
 * pressing Move sends the Move; while it is `busy` nothing else can be done,
 * and an `error` shows under the list.
 */
export function DeckPicker({
  library,
  from,
  cards,
  busy,
  error,
  onMove,
  onClose,
}: {
  library: Library;
  from: Deck;
  cards: readonly Card[] | undefined;
  busy: boolean;
  error: string | undefined;
  onMove: (to: Deck) => void;
  onClose: () => void;
}) {
  return (
    <Dialog.Root
      open={cards !== undefined}
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className={BACKDROP} />
        <Dialog.Popup className={SHEET}>
          {cards !== undefined && (
            <PickerBody
              library={library}
              from={from}
              cards={cards}
              busy={busy}
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

function PickerBody({
  library,
  from,
  cards,
  busy,
  error,
  onMove,
  onClose,
}: {
  library: Library;
  from: Deck;
  cards: readonly Card[];
  busy: boolean;
  error: string | undefined;
  onMove: (to: Deck) => void;
  onClose: () => void;
}) {
  const rows = deckRows(library);
  const [picked, setPicked] = useState<Deck>();
  const one = cards.length === 1 ? cards[0] : undefined;
  return (
    <div className="flex flex-col gap-5">
      <Head title={one === undefined ? `Move ${cards.length} cards` : "Move card"} busy={busy}>
        <Dialog.Description className="line-clamp-2 text-[0.95rem] text-muted-foreground [overflow-wrap:anywhere]">
          {one === undefined
            ? "Which deck should they go to? They keep their tags and history."
            : `Which deck should “${firstLine(one.front)}” go to?`}
        </Dialog.Description>
      </Head>
      <ul
        role="listbox"
        aria-label="Decks"
        className="-mx-2 flex max-h-[min(24rem,50svh)] flex-col gap-0.5 overflow-y-auto rounded-xl border bg-background p-1.5 dark:bg-input/10"
      >
        {rows.map((row) => {
          const indent = { paddingLeft: `${0.75 + row.depth * 1.25}rem` };
          if (row.kind === "folder") {
            return (
              <li
                key={row.id}
                role="presentation"
                style={indent}
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
            <li key={row.deck.id} role="presentation">
              <button
                type="button"
                role="option"
                aria-selected={selected}
                aria-disabled={here}
                disabled={here || busy}
                onClick={() => setPicked(row.deck)}
                style={indent}
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
        <Button
          type="button"
          variant="outline"
          className={OUTLINE_PILL}
          disabled={busy}
          onClick={onClose}
        >
          Cancel
        </Button>
        <Button
          className={cn(PILL, "min-w-0")}
          disabled={picked === undefined || busy}
          onClick={() => picked !== undefined && onMove(picked)}
        >
          <CornerDownRight aria-hidden />
          <span className="truncate">
            {busy ? "Moving…" : picked === undefined ? "Move" : `Move to ${picked.name}`}
          </span>
        </Button>
      </div>
    </div>
  );
}
