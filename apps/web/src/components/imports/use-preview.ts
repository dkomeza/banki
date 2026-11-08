import { type ImportCard, type ImportPreviewResponse, frontKey } from "@banki/shared";
import { useMemo, useState } from "react";
import type { Card } from "@/lib/cards";

// The preview's ticks and edits, in the browser until Confirm, and each
// Card's Duplicate mark, rechecked with `frontKey` against the Deck's live
// Cards and the file's earlier ticked Cards as they change.

/** What a Card is a Duplicate of: a live Card in the Deck, or an earlier Card in the file. */
export type DuplicateOf = { deck: Card; front: string } | { number: number; front: string };

/** One of the preview's Cards as it stands: edited or not, ticked or not, locked or not. */
export type Row = {
  card: ImportCard;
  edited: boolean;
  duplicateOf: DuplicateOf | undefined;
  /** Ticked to be added; a Duplicate never is. */
  ticked: boolean;
};

export type CardEdit = Pick<ImportCard, "front" | "back" | "tags" | "gradingNotes">;

export function usePreview(preview: ImportPreviewResponse, deckCards: readonly Card[]) {
  const [unticked, setUnticked] = useState<ReadonlySet<number>>(() => new Set());
  const [edits, setEdits] = useState<ReadonlyMap<number, CardEdit>>(() => new Map());

  const deckKeys = useMemo(() => {
    const keys = new Map<string, Card>();
    // Oldest first, so the first Card with a key is the one named.
    for (const card of deckCards.toReversed()) {
      const key = frontKey(card.front);
      if (key !== "" && !keys.has(key)) keys.set(key, card);
    }
    return keys;
  }, [deckCards]);
  // Each Card's key, worked out again only for the one an edit changes.
  const originalKeys = useMemo(
    () => new Map(preview.cards.map((card) => [card.number, frontKey(card.front)])),
    [preview],
  );

  const rows = useMemo(() => {
    const seen = new Map<string, ImportCard>();
    return preview.cards.map((original): Row => {
      const edit = edits.get(original.number);
      const card: ImportCard =
        edit === undefined
          ? {
              number: original.number,
              front: original.front,
              back: original.back,
              tags: original.tags,
              gradingNotes: original.gradingNotes,
            }
          : { number: original.number, ...edit, tags: [...edit.tags] };
      const key = edit === undefined ? (originalKeys.get(card.number) ?? "") : frontKey(card.front);
      const inDeck = key === "" ? undefined : deckKeys.get(key);
      const inFile = key === "" ? undefined : seen.get(key);
      const duplicateOf: DuplicateOf | undefined =
        inDeck !== undefined
          ? { deck: inDeck, front: inDeck.front }
          : inFile !== undefined
            ? { number: inFile.number, front: inFile.front }
            : undefined;
      const ticked = duplicateOf === undefined && !unticked.has(card.number);
      if (ticked) seen.set(key, card);
      return { card, edited: edit !== undefined, duplicateOf, ticked };
    });
  }, [preview, edits, unticked, deckKeys, originalKeys]);

  const tickable = rows.filter((row) => row.duplicateOf === undefined);
  const ticked = rows.filter((row) => row.ticked);

  return {
    rows,
    /** The Cards Confirm will add, as they stand. */
    ticked: ticked.map((row) => row.card),
    /** Whether every Card that can be ticked is. */
    allTicked: tickable.every((row) => row.ticked),
    /** Whether the User has changed anything: a tick or an edit, lost on leaving. */
    changed: edits.size > 0 || unticked.size > 0,
    toggle: (number: number) =>
      setUnticked((current) => {
        const next = new Set(current);
        if (next.has(number)) next.delete(number);
        else next.add(number);
        return next;
      }),
    tickAll: (on: boolean) =>
      // Every Card, a Duplicate too, so none is freed by unticking the one it repeats.
      setUnticked(on ? new Set() : new Set(rows.map((row) => row.card.number))),
    edit: (number: number, edit: CardEdit) =>
      setEdits((current) => new Map(current).set(number, edit)),
  };
}

export type Preview = ReturnType<typeof usePreview>;
