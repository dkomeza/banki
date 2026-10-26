// PROTOTYPE (BAN-12): the new-card and edit-card form's state, shared by every
// Variant: Front and Back as typed, each side's inline error, whether anything
// changed, and Ctrl/Cmd+Enter to save.
import { type KeyboardEvent, useRef, useState } from "react";
import type { SideErrors } from "./cards";

type Sides = { front: string; back: string };

/** `initial` is what the fields open with; `saved` what counts as no change. */
export function useCardForm(initial: Sides, saved0: Sides = initial, errors0: SideErrors = {}) {
  const [front, setFront] = useState(initial.front);
  const [back, setBack] = useState(initial.back);
  const [saved, setSaved] = useState(saved0);
  const [errors, setErrors] = useState<SideErrors>(errors0);
  const frontRef = useRef<HTMLTextAreaElement>(null);
  const dirty = front !== saved.front || back !== saved.back;

  return {
    front,
    back,
    errors,
    dirty,
    frontRef,
    setFront: (value: string) => {
      setFront(value);
      if (errors.front !== undefined) setErrors({ back: errors.back });
    },
    setBack: (value: string) => {
      setBack(value);
      if (errors.back !== undefined) setErrors({ front: errors.front });
    },
    setErrors,
    /** Marks the current text as saved, so leaving doesn't ask. */
    markSaved: (next = { front, back }) => {
      setSaved(next);
      setFront(next.front);
      setBack(next.back);
    },
    /** Ctrl/Cmd+Enter on either field calls `save`. */
    onKeyDown: (save: () => void) => (event: KeyboardEvent) => {
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        save();
      }
    },
  };
}
