import { type EditorView, WidgetType } from "@codemirror/view";
import { ImageOff, SquareArrowOutUpRight } from "lucide-react";
import { fullSizeHref, imageFileOf, imageSrc, isImageMissing } from "@/lib/images";
import { iconElement } from "./icons";
import { treeOf } from "./language";
import { snapToLines, unsnap } from "./widgets";

// An image reference's picture, drawn in place of its source while the
// cursor is outside it: what the timeline would show (ADR-0020), an Image
// at where the API serves it or any other URL as written.

/** The end of the first image reference at or after `pos`, on its line. */
function referenceEnd(view: EditorView, pos: number): number | null {
  const line = view.state.doc.lineAt(pos);
  let end: number | null = null;
  treeOf(view.state).iterate({
    from: pos,
    to: line.to,
    enter: (node) => {
      if (end !== null) return false;
      if (node.name !== "Image" || node.from < pos) return undefined;
      end = node.to;
      return false;
    },
  });
  return end;
}

/** The tile of an Image that doesn't exist. */
function missingTile(url: string): HTMLElement {
  const tile = document.createElement("span");
  tile.className = "cm-lp-image-missing";
  tile.setAttribute("role", "img");
  tile.setAttribute("aria-label", `Missing image ${url}`);
  const label = document.createElement("span");
  label.textContent = "Missing image";
  const name = document.createElement("span");
  name.className = "cm-lp-image-missing-name";
  name.textContent = imageFileOf(url) ?? url;
  tile.append(iconElement(ImageOff, "cm-lp-image-missing-icon"), label, name);
  return tile;
}

/** "Open full size": the picture in a new tab. */
function openLink(href: string): HTMLElement {
  const open = document.createElement("a");
  open.className = "cm-lp-image-open";
  open.href = href;
  open.target = "_blank";
  open.rel = "noopener";
  const label = document.createElement("span");
  label.textContent = "Open full size";
  open.append(iconElement(SquareArrowOutUpRight, "cm-lp-image-open-icon"), label);
  return open;
}

/**
 * The picture of an image reference: on lines of its own (`block`), up to the
 * side's width, kept to whole lines so the text after it stays on its rules;
 * or small, on its line, as in a table's cell. A click on it puts the cursor
 * at the end of its source; its one control opens it full size.
 */
export class ImageWidget extends WidgetType {
  constructor(
    readonly url: string,
    readonly alt: string,
    readonly block: boolean,
  ) {
    super();
  }

  override eq(other: ImageWidget) {
    return other.url === this.url && other.alt === this.alt && other.block === this.block;
  }

  toDOM(view: EditorView) {
    const box = document.createElement(this.block ? "div" : "span");
    box.className = `cm-lp-image ${this.block ? "cm-lp-image-block" : "cm-lp-image-inline"}`;
    const frame = document.createElement("span");
    frame.className = "cm-lp-image-frame";
    const img = document.createElement("img");
    img.className = "cm-lp-image-img";
    img.alt = this.alt;
    img.src = imageSrc(this.url);
    const file = imageFileOf(this.url);
    // Missing only when the API says the Image doesn't exist (a 404).
    img.addEventListener("error", () => {
      if (file === undefined) return;
      void isImageMissing(file).then((missing) => {
        if (missing) frame.replaceChildren(missingTile(this.url));
      });
    });
    frame.append(img);
    // Only to a web address: never a `javascript:` or `data:` URL.
    const href = fullSizeHref(this.url, document.baseURI);
    if (href !== undefined) frame.append(openLink(href));
    box.append(frame);
    box.addEventListener("mousedown", (event) => {
      if (event.target instanceof Element && event.target.closest("a") !== null) return;
      event.preventDefault();
      if (view.state.readOnly) return;
      const end = referenceEnd(view, view.posAtDOM(box));
      if (end === null) return;
      view.focus();
      view.dispatch({ selection: { anchor: end }, scrollIntoView: true });
    });
    if (this.block) snapToLines(box, view);
    return box;
  }

  override destroy(dom: HTMLElement) {
    unsnap(dom);
  }

  // Its own handlers take its clicks, and its link opens.
  override ignoreEvent() {
    return true;
  }
}
