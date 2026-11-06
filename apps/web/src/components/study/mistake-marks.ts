import { type RefObject, useCallback, useEffect, useRef, useState } from "react";

// PROTOTYPE (BAN-40): the mistakes in the Written answer as their own
// controls. A mistake carries no number: its note shows while the pointer
// is on it (a mouse), after a tap (touch, or a click, which keeps it open),
// or while it has the focus (Tab), and Escape or a tap elsewhere puts it away.

const SELECTOR = "mark[data-highlight=mistake]";

/** Which mistake's note shows, and whether a tap is holding it open. */
export type Shown = { n: number; held: boolean } | undefined;

export function useMistakeMarks(
  box: RefObject<HTMLElement | null>,
  /** Where the note shows, so the pointer can move into it without it closing. */
  note?: RefObject<HTMLElement | null>,
) {
  const [shown, setShown] = useState<Shown>(undefined);
  const leaving = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const stay = useCallback(() => clearTimeout(leaving.current), []);
  const leave = useCallback(() => {
    clearTimeout(leaving.current);
    leaving.current = setTimeout(() => setShown((s) => (s?.held ? s : undefined)), 180);
  }, []);
  const hide = useCallback(() => setShown(undefined), []);

  // Each mistake is a control: focusable, named, and marked while its note
  // shows. After every render, since CardText draws the marks again.
  useEffect(() => {
    const root = box.current;
    if (root === null) return;
    for (const mark of root.querySelectorAll<HTMLElement>(SELECTOR)) {
      const on = shown !== undefined && mark.dataset["n"] === String(shown.n);
      mark.tabIndex = 0;
      mark.setAttribute("role", "button");
      mark.setAttribute("aria-label", `Mistake ${mark.dataset["n"] ?? ""}: show its note`);
      mark.toggleAttribute("data-active", on);
      mark.setAttribute("aria-expanded", String(on));
    }
  });

  useEffect(() => {
    const root = box.current;
    if (root === null) return () => {};
    const markOf = (target: EventTarget | null) =>
      target instanceof Element ? target.closest<HTMLElement>(SELECTOR) : null;
    const nOf = (mark: HTMLElement) => Number(mark.dataset["n"]);
    const over = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      const mark = markOf(event.target);
      if (mark === null) return;
      stay();
      const n = nOf(mark);
      setShown((s) => ({ n, held: s?.n === n && s.held }));
    };
    const out = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || markOf(event.target) === null) return;
      if (markOf(event.relatedTarget) !== null) return;
      leave();
    };
    const click = (event: MouseEvent) => {
      const mark = markOf(event.target);
      if (mark === null) return;
      const n = nOf(mark);
      setShown((s) => (s?.n === n && s.held ? undefined : { n, held: true }));
    };
    const key = (event: KeyboardEvent) => {
      const mark = markOf(event.target);
      if (mark === null) return;
      if (event.key === "Enter" || event.key === " ") {
        // Enter on a mistake is its own, not the dock's Confirm.
        event.preventDefault();
        event.stopPropagation();
        const n = nOf(mark);
        setShown((s) => (s?.n === n && s.held ? undefined : { n, held: true }));
      }
    };
    const focus = (event: FocusEvent) => {
      const mark = markOf(event.target);
      if (mark !== null) setShown((s) => (s?.n === nOf(mark) ? s : { n: nOf(mark), held: false }));
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
      if (target instanceof Element && target.closest(SELECTOR)) return;
      if (note?.current?.contains(target)) return;
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

  useEffect(() => () => clearTimeout(leaving.current), []);

  /** For the note itself: the pointer on it keeps it open. */
  const noteProps = { onPointerEnter: stay, onPointerLeave: leave };
  return { shown, hide, noteProps };
}

/** Where a mistake's marks sit in `box`: the box around them, and the last line's. */
export function markRects(box: HTMLElement, n: number) {
  const origin = box.getBoundingClientRect();
  const rects = [...box.querySelectorAll<HTMLElement>(`${SELECTOR}[data-n="${n}"]`)].flatMap(
    (mark) => [...mark.getClientRects()],
  );
  if (rects.length === 0) return undefined;
  const last = rects.reduce((a, b) =>
    b.bottom > a.bottom + 1 || (Math.abs(b.bottom - a.bottom) <= 1 && b.right > a.right) ? b : a,
  );
  const top = Math.min(...rects.map((r) => r.top)) - origin.top;
  const bottom = Math.max(...rects.map((r) => r.bottom)) - origin.top;
  return {
    top,
    bottom,
    last: {
      left: last.left - origin.left,
      right: last.right - origin.left,
      bottom: last.bottom - origin.top,
    },
  };
}

/** Marks on mistakes: d's tint and red underline, stronger while its note shows, and a pointer. */
export const MISTAKE_MARKS =
  "[&_mark[data-highlight=mistake]]:cursor-pointer [&_mark[data-highlight=mistake]]:bg-destructive/10 [&_mark[data-highlight=mistake]]:text-inherit [&_mark[data-highlight=mistake]]:shadow-[inset_0_-2px_0_var(--destructive)] [&_mark[data-highlight=mistake]]:[box-decoration-break:clone] [&_mark[data-highlight=mistake]]:rounded-t-[0.2em] [&_mark[data-highlight=mistake]]:transition-colors [&_mark[data-highlight=mistake]]:outline-none [&_mark[data-highlight=mistake]:hover]:bg-destructive/20 [&_mark[data-highlight=mistake][data-active]]:bg-destructive/20 [&_mark[data-highlight=mistake]:focus-visible]:outline-2 [&_mark[data-highlight=mistake]:focus-visible]:outline-offset-2 [&_mark[data-highlight=mistake]:focus-visible]:outline-ring";
