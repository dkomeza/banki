// Prototype only (BAN-13): Recently deleted's list held in the page, with
// Restore and Delete permanently acting on it, and the `?state=` the page was
// opened with played out as it loads.
import { useEffect, useRef, useState } from "react";
import {
  type DeletedState,
  type Deletion,
  STATE_TARGETS,
  seedDeletions,
} from "@/lib/deletions-proto";

export function useDeletions(state: DeletedState | undefined, onRestore: (d: Deletion) => void) {
  // What the state acts on, and the list as it is once it has.
  const [opening] = useState(() => {
    const all = state === "empty" ? [] : seedDeletions();
    const target =
      state === undefined || state === "empty"
        ? undefined
        : all.find((e) => e.id === STATE_TARGETS[state]);
    const restoring = state !== "delete" ? target : undefined;
    const kept =
      restoring && restoring.restore.kind !== "refused"
        ? all.filter((e) => e.id !== restoring.id)
        : all;
    return { entries: kept, restoring, confirming: state === "delete" ? target : undefined };
  });
  const [entries, setEntries] = useState(opening.entries);
  const [confirming, setConfirming] = useState(opening.confirming);

  // The opening Restore's toast, once.
  const toasted = useRef(false);
  useEffect(() => {
    if (toasted.current || opening.restoring === undefined) return;
    toasted.current = true;
    onRestore(opening.restoring);
  }, [opening, onRestore]);

  const restore = (d: Deletion) => {
    onRestore(d);
    if (d.restore.kind !== "refused") setEntries((all) => all.filter((e) => e.id !== d.id));
  };
  const remove = (d: Deletion) => {
    setEntries((all) => all.filter((e) => e.id !== d.id));
    setConfirming(undefined);
  };

  return { entries, restore, remove, confirming, setConfirming };
}
