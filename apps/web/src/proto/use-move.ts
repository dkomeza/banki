// PROTOTYPE (BAN-10): moving, shared by the Move… picker and drag and drop. A
// move that clashes with a name holds the clash for the popup, which sends the
// same move again with the User's choice.
import { type DragEvent, useState } from "react";
import {
  type Clash,
  type Item,
  type Place,
  cantMoveTo,
  move,
  setDragging,
  useDragging,
  useLibrary,
} from "./folders";

export function useMove(initialClash?: Clash) {
  const [clash, setClash] = useState<Clash | undefined>(initialClash);
  const [error, setError] = useState<string>();
  const request = (item: Item, destination: Place, onDone?: () => void) => {
    const outcome = move(item, destination);
    if (outcome.ok) {
      onDone?.();
      return true;
    }
    if ("clash" in outcome) setClash(outcome.clash);
    else setError(outcome.error);
    return false;
  };
  const resolve = (choice: "replace" | "keepBoth" | "cancel") => {
    // A fixture clash (from `?state=clash`) has nothing behind it to move.
    if (clash && choice !== "cancel" && !clash.existing.id.startsWith("clash-")) {
      move(clash.item, clash.destination, choice);
    }
    setClash(undefined);
  };
  return { clash, error, request, resolve, clearError: () => setError(undefined) };
}

/** Makes a tile draggable with a mouse or trackpad. */
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
 * Makes a folder tile or a breadcrumb item a drop target. `over` is true while
 * an item that may move there is dragged over it; a drop on its current
 * place, itself or inside itself does nothing.
 */
export function useDropTarget(place: Place, onDrop: (item: Item, place: Place) => void) {
  const lib = useLibrary();
  const dragging = useDragging();
  const [over, setOver] = useState(false);
  const allowed = dragging !== undefined && cantMoveTo(lib, dragging, place) === undefined;
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
        if (dragging && allowed) onDrop(dragging, place);
        setDragging(undefined);
      },
    },
  };
}
