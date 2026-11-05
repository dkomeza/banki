import { frontKey } from "@banki/shared";
import { useMemo, useState } from "react";
import type { Card } from "@/lib/cards";
import type { FileCard, ImportPreview } from "./fixtures";

// Prototype only (BAN-32): the preview's ticks and edits, in the browser until
// Confirm, and each Card's Duplicate mark, rechecked with `frontKey` against
// the Deck's live Cards and the file's earlier ticked Cards as they change.

/** What a Card is a Duplicate of: a live Card in the Deck, or an earlier Card in the file. */
export type DuplicateOf = { deck: Card } | { file: number; front: string };

/** One of the preview's Cards as it stands: edited or not, ticked or not, locked or not. */
export type Row = {
  card: FileCard;
  edited: boolean;
  duplicateOf: DuplicateOf | undefined;
  /** Ticked to be added; a Duplicate never is. */
  ticked: boolean;
  imageProblem: boolean;
};

export type CardEdit = Pick<FileCard, "front" | "back" | "tags" | "gradingNotes">;

export function usePreview(preview: ImportPreview, deckCards: readonly Card[]) {
  const [unticked, setUnticked] = useState<ReadonlySet<number>>(() => new Set(preview.unticked));
  const [edits, setEdits] = useState<ReadonlyMap<number, CardEdit>>(() => new Map());

  const deckKeys = useMemo(() => {
    const keys = new Map<string, Card>();
    for (const card of deckCards) keys.set(frontKey(card.front), card);
    return keys;
  }, [deckCards]);
  const imageCards = useMemo(() => new Set(preview.images.map((image) => image.card)), [preview]);

  const rows = useMemo(() => {
    const seen = new Map<string, FileCard>();
    return preview.cards.map((original): Row => {
      const edit = edits.get(original.number);
      const card = edit === undefined ? original : { ...original, ...edit };
      const key = frontKey(card.front);
      const inDeck = key === "" ? undefined : deckKeys.get(key);
      const inFile = key === "" ? undefined : seen.get(key);
      const duplicateOf: DuplicateOf | undefined =
        inDeck !== undefined
          ? { deck: inDeck }
          : inFile !== undefined
            ? { file: inFile.number, front: inFile.front }
            : undefined;
      const ticked = duplicateOf === undefined && !unticked.has(card.number);
      if (ticked) seen.set(key, card);
      return {
        card,
        edited: edit !== undefined,
        duplicateOf,
        ticked,
        imageProblem: imageCards.has(card.number),
      };
    });
  }, [preview, edits, unticked, deckKeys, imageCards]);

  const tickable = rows.filter((row) => row.duplicateOf === undefined);
  const ticked = rows.filter((row) => row.ticked).length;
  const initialUnticked = new Set(preview.unticked);
  const changed =
    edits.size > 0 ||
    unticked.size !== initialUnticked.size ||
    [...unticked].some((number) => !initialUnticked.has(number));

  return {
    rows,
    /** How many Cards Confirm will add. */
    ticked,
    duplicates: rows.length - tickable.length,
    /** Whether every Card that can be ticked is. */
    allTicked: tickable.every((row) => row.ticked),
    changed,
    toggle: (number: number) =>
      setUnticked((current) => {
        const next = new Set(current);
        if (next.has(number)) next.delete(number);
        else next.add(number);
        return next;
      }),
    tickAll: (on: boolean) =>
      setUnticked(on ? new Set() : new Set(tickable.map((row) => row.card.number))),
    edit: (number: number, edit: CardEdit) =>
      setEdits((current) => new Map(current).set(number, edit)),
  };
}

export type Preview = ReturnType<typeof usePreview>;
