import { type EditorView, WidgetType } from "@codemirror/view";
import { typeset } from "@/lib/formula";

// What the live preview draws in place of source: a typeset Formula, a
// display Formula's live render under its source, and a bullet.
//
// Each side is written on ruled lines, one rule per line of text. A block the
// editor draws (a display Formula, its live render) is made as tall as a whole
// number of lines, so the text after it stays on its rules.

const observers = new WeakMap<HTMLElement, ResizeObserver>();

/**
 * Keeps `box` a whole number of the editor's lines tall, its content (its
 * first child) centred in it, however tall the content renders.
 */
export function snapToLines(box: HTMLElement, view: EditorView): void {
  const content = box.firstElementChild;
  if (!(content instanceof HTMLElement) || typeof ResizeObserver === "undefined") return;
  box.classList.add("cm-lp-snap");
  const observer = new ResizeObserver(() => {
    const line = Number.parseFloat(getComputedStyle(view.contentDOM).lineHeight);
    if (!(line > 0)) return;
    const style = getComputedStyle(content);
    const natural =
      content.getBoundingClientRect().height +
      Number.parseFloat(style.marginTop) +
      Number.parseFloat(style.marginBottom);
    // A hair under a whole line counts as that line, against rounding.
    const height = `${Math.max(1, Math.ceil(natural / line - 0.02)) * line}px`;
    if (box.style.height === height) return;
    box.style.height = height;
    view.requestMeasure();
  });
  observer.observe(content);
  observers.set(box, observer);
}

/** Stops keeping `box` to whole lines. */
export function unsnap(box: HTMLElement): void {
  observers.get(box)?.disconnect();
  observers.delete(box);
}

/**
 * Fills `el` with a typeset Formula or, for broken LaTeX, as the timeline
 * shows it: its source with its delimiters in red, then its error message.
 */
function fillFormula(el: HTMLElement, source: string, display: boolean): void {
  const result = typeset(source, display);
  if ("html" in result) {
    el.innerHTML = result.html;
    return;
  }
  const delimiter = display ? "$$" : "$";
  el.classList.add("cm-lp-broken");
  const text = document.createElement("span");
  text.className = "cm-lp-broken-source";
  text.textContent = `${delimiter}${source}${delimiter}`;
  const message = document.createElement("span");
  message.className = "cm-lp-broken-message";
  message.textContent = result.error;
  el.append(text, " ", message);
}

/**
 * A Formula typeset in place of its source while the cursor is outside it.
 * `block` is a display Formula on lines of its own; a display Formula inside
 * a paragraph still shows as a block, on its line.
 */
export class FormulaWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly display: boolean,
    readonly block: boolean,
  ) {
    super();
  }

  override eq(other: FormulaWidget) {
    return (
      other.source === this.source && other.display === this.display && other.block === this.block
    );
  }

  toDOM(view: EditorView) {
    if (!this.display) {
      const el = document.createElement("span");
      el.className = "cm-lp-formula cm-lp-formula-inline";
      fillFormula(el, this.source, false);
      return el;
    }
    const box = document.createElement(this.block ? "div" : "span");
    box.className = "cm-lp-formula cm-lp-formula-display";
    const content = document.createElement(this.block ? "div" : "span");
    content.className = "cm-lp-formula-display-content";
    fillFormula(content, this.source, true);
    box.append(content);
    snapToLines(box, view);
    return box;
  }

  override destroy(dom: HTMLElement) {
    unsnap(dom);
  }

  // A click on it reaches the editor, which puts the cursor in its source.
  override ignoreEvent() {
    return false;
  }
}

/** A display Formula's live render, a block right under its source while it is edited. */
export class LiveRenderWidget extends WidgetType {
  constructor(readonly source: string) {
    super();
  }

  override eq(other: LiveRenderWidget) {
    return other.source === this.source;
  }

  toDOM(view: EditorView) {
    const box = document.createElement("div");
    box.className = "cm-lp-live";
    // The source above it is what assistive tech reads.
    box.setAttribute("aria-hidden", "true");
    const content = document.createElement("div");
    content.className = "cm-lp-live-content";
    const result = typeset(this.source, true);
    if ("error" in result) {
      content.classList.add("cm-lp-live-error");
      content.textContent = result.error;
    } else content.innerHTML = result.html;
    box.append(content);
    snapToLines(box, view);
    return box;
  }

  override destroy(dom: HTMLElement) {
    unsnap(dom);
  }
}

/** A `-` or `*` list marker, shown as a bullet. */
export class BulletWidget extends WidgetType {
  override eq() {
    return true;
  }

  toDOM() {
    const el = document.createElement("span");
    el.className = "cm-lp-bullet";
    el.textContent = "•";
    return el;
  }
}

/** The inline Formula's popover: its render, its error, or a hint while it is empty. */
export function popoverContent(source: string): HTMLElement {
  const dom = document.createElement("div");
  dom.className = "cm-lp-popover";
  // The source it floats under is what assistive tech reads.
  dom.setAttribute("aria-hidden", "true");
  const result = typeset(source, false);
  if (source.trim() === "") {
    dom.classList.add("cm-lp-popover-empty");
    dom.textContent = "Type LaTeX";
  } else if ("error" in result) {
    dom.classList.add("cm-lp-popover-error");
    dom.textContent = result.error;
  } else dom.innerHTML = result.html;
  return dom;
}
