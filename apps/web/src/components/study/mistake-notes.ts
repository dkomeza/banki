import { type RefObject, useCallback, useEffect, useRef, useState } from "react";

// The mistakes marked in a Written answer, as controls that show their notes.
// A mistake's note shows while the pointer is on it (a mouse), after a tap or
// a click (which holds it open), or while it has the focus (Tab, or Enter on
// it to hold it); Escape or a tap anywhere else puts it away. The marks are
// CardText's, drawn again on every render, so each one is made a control in
// the page as it is drawn, and the events are read on the box around them.

const MISTAKE = "mark[data-highlight=mistake]";

/** Which mistake's note shows, by its `n`, and whether a tap or Enter holds it open. */
export type ShownNote = { n: number; held: boolean } | undefined;

/** How long the pointer may be off a mistake and its note before the note goes. */
const LEAVE_MS = 180;

const markOf = (target: EventTarget | null) =>
  target instanceof Element ? target.closest<HTMLElement>(MISTAKE) : null;
const nOf = (mark: HTMLElement) => Number(mark.dataset["n"]);

/**
 * The note shown for the mistakes marked in `box`. `note` is where the note
 * shows: the pointer can move into it without it going, and a tap in it
 * keeps it. `labelOf` names each mistake's control for screen readers.
 */
export function useMistakeNotes(
  box: RefObject<HTMLElement | null>,
  note: RefObject<HTMLElement | null>,
  labelOf: (n: number) => string,
) {
  const [shown, setShown] = useState<ShownNote>(undefined);
  const leaving = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const stay = useCallback(() => clearTimeout(leaving.current), []);
  const leave = useCallback(() => {
    clearTimeout(leaving.current);
    leaving.current = setTimeout(() => setShown((s) => (s?.held ? s : undefined)), LEAVE_MS);
  }, []);
  useEffect(() => () => clearTimeout(leaving.current), []);

  // Each mistake is one control: its first mark takes the focus (a mistake
  // across emphasis is marked in pieces), and every mark shows whether its
  // note is open.
  useEffect(() => {
    const root = box.current;
    if (root === null) return;
    const first = new Set<number>();
    for (const mark of root.querySelectorAll<HTMLElement>(MISTAKE)) {
      const n = nOf(mark);
      const open = shown?.n === n;
      mark.tabIndex = first.has(n) ? -1 : 0;
      first.add(n);
      mark.setAttribute("role", "button");
      mark.setAttribute("aria-label", labelOf(n));
      mark.setAttribute("aria-expanded", String(open));
      mark.toggleAttribute("data-open", open);
    }
  });

  useEffect(() => {
    const root = box.current;
    if (root === null) return () => {};
    const toggle = (n: number) =>
      setShown((s) => (s?.n === n && s.held ? undefined : { n, held: true }));
    const over = (event: PointerEvent) => {
      const mark = markOf(event.target);
      if (event.pointerType !== "mouse" || mark === null) return;
      stay();
      const n = nOf(mark);
      setShown((s) => (s?.n === n ? s : { n, held: false }));
    };
    const out = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || markOf(event.target) === null) return;
      if (markOf(event.relatedTarget) === null) leave();
    };
    const click = (event: MouseEvent) => {
      const mark = markOf(event.target);
      if (mark !== null) toggle(nOf(mark));
    };
    const key = (event: KeyboardEvent) => {
      const mark = markOf(event.target);
      if (mark === null || (event.key !== "Enter" && event.key !== " ")) return;
      // Enter on a mistake is its own, not the dock's Confirm.
      event.preventDefault();
      event.stopPropagation();
      toggle(nOf(mark));
    };
    const focus = (event: FocusEvent) => {
      const mark = markOf(event.target);
      if (mark === null) return;
      stay();
      const n = nOf(mark);
      setShown((s) => (s?.n === n ? s : { n, held: false }));
    };
    const blur = (event: FocusEvent) => {
      if (markOf(event.target) !== null && markOf(event.relatedTarget) === null) leave();
    };
    root.addEventListener("pointerover", over);
    root.addEventListener("pointerout", out);
    root.addEventListener("click", click);
    root.addEventListener("keydown", key);
    root.addEventListener("focusin", focus);
    root.addEventListener("focusout", blur);
    return () => {
      root.removeEventListener("pointerover", over);
      root.removeEventListener("pointerout", out);
      root.removeEventListener("click", click);
      root.removeEventListener("keydown", key);
      root.removeEventListener("focusin", focus);
      root.removeEventListener("focusout", blur);
    };
  }, [box, stay, leave]);

  // A tap anywhere else, or Escape, puts the note away.
  useEffect(() => {
    if (shown === undefined) return () => {};
    const away = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (markOf(target) !== null || note.current?.contains(target)) return;
      setShown(undefined);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // The note goes first; the screen's own Escape waits for the next one.
      event.preventDefault();
      setShown(undefined);
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", escape, true);
    };
  }, [shown, note]);

  /** For the note: the pointer on it keeps it open. */
  const noteProps = { onPointerEnter: stay, onPointerLeave: leave };
  return { shown, noteProps };
}

/** Where mistake `n`'s marks sit in `box`: below their last line, and that line's left and right. */
export function lastLineOf(box: HTMLElement, n: number) {
  const origin = box.getBoundingClientRect();
  const rects = [...box.querySelectorAll<HTMLElement>(`${MISTAKE}[data-n="${n}"]`)].flatMap(
    (mark) => [...mark.getClientRects()],
  );
  const last = rects.reduce<DOMRect | undefined>(
    (a, b) =>
      a === undefined ||
      b.bottom > a.bottom + 1 ||
      (Math.abs(b.bottom - a.bottom) <= 1 && b.right > a.right)
        ? b
        : a,
    undefined,
  );
  if (last === undefined) return undefined;
  return {
    bottom: last.bottom - origin.top,
    left: last.left - origin.left,
    right: last.right - origin.left,
  };
}
