// Prototype only (BAN-15): what every Variant of selection mode and the
// destination picker shares. The Move is faked in the query cache, since
// `POST /api/cards/move` doesn't exist yet; Delete is real, one request per
// Card. `?state=` opens each state the Design Review looks at.
import type { QueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { type MouseEvent, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { UNDO_MS } from "@/components/deleted/toasts";
import { type Card, cardsQueryOptions, deleteCard, forgetCard } from "@/lib/cards";
import type { Deck } from "@/lib/decks";
import { restoreDeletion } from "@/lib/deletions";
import { type Library, ROOT_NAME } from "@/lib/folders";

export type ProtoState = "selecting" | "selected" | "picker" | "picker-one" | "moved";
const STATES: readonly ProtoState[] = ["selecting", "selected", "picker", "picker-one", "moved"];

/** The `?state=` the page was opened with, read once. */
export function protoState(): ProtoState | undefined {
  if (typeof window === "undefined") return undefined;
  const state = new URLSearchParams(window.location.search).get("state");
  return STATES.find((s) => s === state);
}

/** The Spanish vocabulary Cards the `selected` state picks: two tagged `food`, one not. */
export const SELECTED_FRONTS = ["la cuenta", "la sobremesa", "madrugar"] as const;
/** The Tag the `selected` state filters by, hiding one of the three. */
export const SELECTED_FILTER = "food";
/** The Deck the `moved` state's Move went to. */
export const MOVED_TO = "Japanese kanji (JLPT N4)";

/**
 * Selection mode's state: whether it is on, the selected Card IDs, and the
 * last one clicked, which a Shift-click selects the range from.
 */
export function useSelection() {
  const [active, setActive] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [anchor, setAnchor] = useState<string>();

  const enter = useCallback(() => setActive(true), []);
  const exit = useCallback(() => {
    setActive(false);
    setSelected(new Set());
    setAnchor(undefined);
  }, []);

  /**
   * Toggles a Card, or with Shift held, selects every shown Card between the
   * last one clicked and this one (`shown` in timeline order).
   */
  const toggle = (id: string, shown: readonly string[], event?: MouseEvent) => {
    if (event?.shiftKey && anchor !== undefined) {
      const from = shown.indexOf(anchor);
      const to = shown.indexOf(id);
      if (from !== -1 && to !== -1) {
        const [lo, hi] = from < to ? [from, to] : [to, from];
        setSelected((prev) => new Set([...prev, ...shown.slice(lo, hi + 1)]));
        setAnchor(id);
        return;
      }
    }
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setAnchor(id);
  };

  /** Selects every shown Card, or, when they all are, unselects them. */
  const selectAll = (shown: readonly string[]) =>
    setSelected((prev) =>
      shown.every((id) => prev.has(id))
        ? new Set([...prev].filter((id) => !shown.includes(id)))
        : new Set([...prev, ...shown]),
    );

  return { active, selected, enter, exit, toggle, selectAll, setSelected, setActive };
}

export type Selection = ReturnType<typeof useSelection>;

/** One row of the destination picker: a Folder heading or a Deck to pick. */
export type DeckRow =
  | { kind: "folder"; id: string; name: string; depth: number; path: string }
  | { kind: "deck"; deck: Deck; depth: number; path: string };

const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/**
 * Every live Deck in its Folder tree: the Root's Decks first, then each
 * Folder as a heading with its Decks and its Folders under it, by name.
 * A Folder with no Deck anywhere inside is left out. `path` is where the row
 * is ("Languages › Spanish").
 */
export function deckRows(library: Library): DeckRow[] {
  const rows: DeckRow[] = [];
  const decksIn = (place: string | null) =>
    library.decks
      .filter((d) => d.folderId === place)
      .toSorted((a, b) => byName.compare(a.name, b.name));
  const foldersIn = (place: string | null) =>
    library.folders
      .filter((f) => f.parentId === place)
      .toSorted((a, b) => byName.compare(a.name, b.name));
  const hasDecks = (id: string): boolean =>
    decksIn(id).length > 0 || foldersIn(id).some((f) => hasDecks(f.id));
  const walk = (place: string | null, depth: number, path: string) => {
    for (const deck of decksIn(place)) rows.push({ kind: "deck", deck, depth, path });
    for (const folder of foldersIn(place)) {
      if (!hasDecks(folder.id)) continue;
      const inner = path === "" ? folder.name : `${path} › ${folder.name}`;
      rows.push({ kind: "folder", id: folder.id, name: folder.name, depth, path: inner });
      walk(folder.id, depth + 1, inner);
    }
  };
  walk(null, 0, "");
  return rows;
}

export const rootName = ROOT_NAME;

/** "Moved 3 cards to " or "Moved card to ". */
const movedTitle = (count: number) => (count === 1 ? "Moved card to " : `Moved ${count} cards to `);

/**
 * Prototype: moves `cards` from `from` to `to` in the query cache only, and
 * shows "Moved 3 cards to Verbs", the Deck linking to it, with Undo, which
 * puts them back. The `moved` state keeps it up (`duration` Infinity).
 */
export function moveWithUndo(
  queryClient: QueryClient,
  cards: readonly Card[],
  from: Deck,
  to: Pick<Deck, "id" | "name">,
  duration = UNDO_MS,
) {
  const ids = new Set(cards.map((c) => c.id));
  const key = cardsQueryOptions(from.id).queryKey;
  const before = queryClient.getQueryData(key);
  queryClient.setQueryData(key, (list) => list?.filter((c) => !ids.has(c.id)));
  const toastId = `moved-${[...ids].join("-")}`;
  toast(
    <span>
      {movedTitle(cards.length)}
      <Link
        to="/decks/$deckId"
        params={{ deckId: to.id }}
        className="font-semibold text-foreground underline underline-offset-4 [overflow-wrap:anywhere]"
        onClick={() => toast.dismiss(toastId)}
      >
        {to.name}
      </Link>
    </span>,
    {
      id: toastId,
      duration,
      action: {
        label: "Undo",
        onClick: () => {
          if (before !== undefined) queryClient.setQueryData(key, before);
        },
      },
    },
  );
}

/**
 * Deletes `cards` at once, without asking, one Deletion each, and shows
 * "3 cards deleted" with Undo, which restores all of them. One Card alone
 * keeps "Card deleted".
 */
export async function deleteAllWithUndo(queryClient: QueryClient, cards: readonly Card[]) {
  const outcomes = await Promise.all(cards.map((card) => deleteCard(queryClient, card)));
  const failed = outcomes.find((o) => !o.ok);
  if (failed !== undefined && !failed.ok) {
    toast.error(failed.message);
    return;
  }
  for (const card of cards) forgetCard(queryClient, card.id);
  const deletionIds = outcomes.flatMap((o) => (o.ok && o.deletionId ? [o.deletionId] : []));
  toast(cards.length === 1 ? "Card deleted" : `${cards.length} cards deleted`, {
    id: `cards-deleted-${deletionIds.join("-")}`,
    duration: UNDO_MS,
    action: {
      label: "Undo",
      onClick: () => {
        void Promise.all(deletionIds.map((id) => restoreDeletion(queryClient, id))).then(
          (restored) => {
            const bad = restored.find((r) => !r.ok);
            if (bad === undefined || bad.ok) return;
            toast.error(
              "placeDeleted" in bad ? "Couldn't undo: the cards' deck was deleted." : bad.message,
            );
          },
        );
      },
    },
  });
}

/**
 * Opens the state `?state=` names once, on the deck page's first render:
 * selection mode, three Cards selected under a filter that hides one, the
 * picker for them or for one Card, or the toast after a Move. Esc leaves
 * selection mode while no picker is open.
 */
export function useProtoStates({
  queryClient,
  deck,
  cards,
  library,
  selection,
  picking,
  pick,
  filterBy,
}: {
  queryClient: QueryClient;
  deck: Deck;
  cards: readonly Card[];
  library: Library;
  selection: Selection;
  picking: boolean;
  pick: (cards: readonly Card[]) => void;
  filterBy: (tag: string) => void;
}) {
  const [state] = useState(protoState);
  // Once, on the first render.
  /* oxlint-disable react/exhaustive-effect-dependencies, react-hooks/exhaustive-deps */
  useEffect(() => {
    if (state === undefined) return;
    const three = cards.filter((c) => (SELECTED_FRONTS as readonly string[]).includes(c.front));
    if (state === "moved") {
      const to = library.decks.find((d) => d.name === MOVED_TO);
      if (to !== undefined) moveWithUndo(queryClient, three, deck, to, Number.POSITIVE_INFINITY);
      return;
    }
    if (state === "picker-one") {
      const newest = cards[0];
      if (newest !== undefined) pick([newest]);
      return;
    }
    selection.enter();
    if (state === "selecting") return;
    selection.setSelected(new Set(three.map((c) => c.id)));
    filterBy(SELECTED_FILTER);
    if (state === "picker") pick(three);
  }, []);
  /* oxlint-enable react/exhaustive-effect-dependencies, react-hooks/exhaustive-deps */

  const { active, exit } = selection;
  useEffect(() => {
    if (!active || picking) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") exit();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [active, exit, picking]);
}
