import { useCallback, useState } from "react";

// Selection mode on the deck page: which Cards are selected, and the last one
// clicked, which a Shift-click selects a range from. The selection is kept
// across filter changes, so it may hold Cards the timeline doesn't show.

export type Selected = ReadonlySet<string>;

/**
 * The selection after a click on Card `id`: with `range` (Shift held) and a
 * last-clicked `anchor` among the `shown` Cards, every shown Card between the
 * two, both ends included, is added; otherwise the Card is toggled. `shown` is
 * the timeline's Cards in timeline order.
 */
export function clicked(
  selected: Selected,
  id: string,
  shown: readonly string[],
  { range, anchor }: { range: boolean; anchor: string | undefined },
): Selected {
  if (range && anchor !== undefined) {
    const from = shown.indexOf(anchor);
    const to = shown.indexOf(id);
    if (from !== -1 && to !== -1) {
      const [lo, hi] = from < to ? [from, to] : [to, from];
      return new Set([...selected, ...shown.slice(lo, hi + 1)]);
    }
  }
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** Whether every shown Card is selected; false when none are shown. */
export const allShownSelected = (selected: Selected, shown: readonly string[]) =>
  shown.length > 0 && shown.every((id) => selected.has(id));

/**
 * Select all: adds every shown Card to the selection, or, when they all are
 * in it already, takes them out (Select none). Hidden selected Cards stay.
 */
export function selectAllShown(selected: Selected, shown: readonly string[]): Selected {
  if (allShownSelected(selected, shown)) {
    const out = new Set(shown);
    return new Set([...selected].filter((id) => !out.has(id)));
  }
  return new Set([...selected, ...shown]);
}

/** The selected Cards that are still among `cards`, in their order. */
export const selectedOf = <T extends { id: string }>(selected: Selected, cards: readonly T[]) =>
  cards.filter((card) => selected.has(card.id));

/** Selection mode's state: whether it is on, the selected Card IDs, and the last one clicked. */
export function useSelection() {
  const [active, setActive] = useState(false);
  const [selected, setSelected] = useState<Selected>(() => new Set());
  const [anchor, setAnchor] = useState<string>();

  const enter = useCallback(() => setActive(true), []);
  const exit = useCallback(() => {
    setActive(false);
    setSelected(new Set());
    setAnchor(undefined);
  }, []);
  const click = useCallback(
    (id: string, shown: readonly string[], range: boolean) => {
      setSelected((prev) => clicked(prev, id, shown, { range, anchor }));
      setAnchor(id);
    },
    [anchor],
  );
  const selectAll = useCallback(
    (shown: readonly string[]) => setSelected((prev) => selectAllShown(prev, shown)),
    [],
  );

  return { active, selected, enter, exit, click, selectAll };
}

export type Selection = ReturnType<typeof useSelection>;
