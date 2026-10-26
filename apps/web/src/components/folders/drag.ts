// Drag and drop, with a mouse or a trackpad only: touch moves with Move…. A
// Deck or Folder tile is the source, and a Folder tile or row or a breadcrumb
// item the target. Native HTML5 drag and drop; the item being dragged is kept
// here, since a drop target can't read the drag's data until the drop.
import { type DragEvent, useState, useSyncExternalStore } from "react";
import { type Item, type Library, type Place, cantMoveTo } from "@/lib/folders";

let dragging: Item | undefined;
const listeners = new Set<() => void>();

function setDragging(item: Item | undefined) {
  dragging = item;
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const FINE = "(pointer: fine)";

/** Whether this device points with a mouse or a trackpad, which can drag. */
export function useFinePointer(): boolean {
  return useSyncExternalStore(
    (listener) => {
      const query = matchMedia(FINE);
      query.addEventListener("change", listener);
      return () => query.removeEventListener("change", listener);
    },
    () => matchMedia(FINE).matches,
  );
}

/** The props that let a tile be dragged, when `enabled`. */
export function dragSource(item: Item, enabled: boolean) {
  if (!enabled) return {};
  return {
    draggable: true,
    onDragStart: (event: DragEvent) => {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", item.id);
      setDragging(item);
    },
    onDragEnd: () => setDragging(undefined),
  };
}

/**
 * Makes a Folder tile or a breadcrumb item a drop target for `place`. `over`
 * is true while something that may move there is held over it; a drop on its
 * current place, on itself or inside itself is no drop at all.
 */
export function useDropTarget(
  library: Library,
  place: Place,
  onDrop: (item: Item, place: Place) => void,
) {
  const item = useSyncExternalStore(subscribe, () => dragging);
  const [over, setOver] = useState(false);
  const allowed = item !== undefined && cantMoveTo(library, item, place) === undefined;
  return {
    over: over && allowed,
    props: {
      onDragOver: (event: DragEvent) => {
        if (!allowed) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setOver(true);
      },
      onDragLeave: () => setOver(false),
      onDrop: (event: DragEvent) => {
        event.preventDefault();
        setOver(false);
        if (item !== undefined && allowed) onDrop(item, place);
        setDragging(undefined);
      },
    },
  };
}
