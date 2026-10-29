import { imageMarkdown } from "@banki/shared";
import {
  type EditorState,
  type Extension,
  Facet,
  type Range,
  StateEffect,
  StateField,
} from "@codemirror/state";
import { isolateHistory } from "@codemirror/commands";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ImageOff,
  LoaderCircle,
  type LucideIcon,
  SquareArrowOutUpRight,
  TriangleAlert,
  X,
} from "lucide-react";
import { imageSrc, isImageMissing, type UploadOutcome } from "@/lib/images";
import { protoState } from "@/lib/proto-state";
import { treeOf } from "./language";
import { snapToLines, unsnap } from "./widgets";

// Images in the live-preview editor (BAN-20, prototype): a reference renders
// as its picture off-cursor, files pasted, dropped or picked upload into the
// side, each with an uploading widget at its insertion point that turns into
// the reference, or into an error tile in place.

/** Uploads a file as an Image; an editor without one takes no files. */
export type Upload = (file: File) => Promise<UploadOutcome>;

export const uploadFunction = Facet.define<Upload | null, Upload | null>({
  combine: (values) => values[0] ?? null,
});

/** An upload on its way, or one that failed, at the point it goes in. */
export type Pending = { id: number; pos: number; name: string; failed?: string };

export const addPending = StateEffect.define<Pending>({
  map: (value, changes) => ({ ...value, pos: changes.mapPos(value.pos, 1) }),
});
const failPending = StateEffect.define<{ id: number; message: string }>();
const dropPending = StateEffect.define<number>();
/** Dismisses every error tile: the form saved or cleared. */
export const clearFailures = StateEffect.define();
/** Where a file dragged over the side would go, or null. */
export const setDropAt = StateEffect.define<number | null>();

let nextId = 1;
export const pendingId = () => nextId++;

export const pendingField = StateField.define<readonly Pending[]>({
  create: () => [],
  update(value, tr) {
    let next = tr.docChanged
      ? value.map((p) => ({ ...p, pos: tr.changes.mapPos(p.pos, 1) }))
      : value;
    for (const effect of tr.effects) {
      if (effect.is(addPending)) next = [...next, effect.value];
      else if (effect.is(failPending)) {
        next = next.map((p) =>
          p.id === effect.value.id ? { ...p, failed: effect.value.message } : p,
        );
      } else if (effect.is(dropPending)) next = next.filter((p) => p.id !== effect.value);
      else if (effect.is(clearFailures)) next = next.filter((p) => p.failed === undefined);
    }
    return next;
  },
});

const dropField = StateField.define<number | null>({
  create: () => null,
  update(value, tr) {
    let next = value === null || !tr.docChanged ? value : tr.changes.mapPos(value);
    for (const effect of tr.effects) if (effect.is(setDropAt)) next = effect.value;
    return next;
  },
});

/** How many uploads are on their way, which holds Save. */
export const uploadingCount = (state: EditorState) =>
  state.field(pendingField, false)?.filter((p) => p.failed === undefined).length ?? 0;

/**
 * Where a block drawn at `pos` sits: under the line `pos` is on, or over it
 * when `pos` starts a line with text on it.
 */
function blockSpot(state: EditorState, pos: number): { at: number; side: number } {
  const line = state.doc.lineAt(pos);
  if (pos === line.from && line.length > 0) return { at: line.from, side: -1 };
  return { at: line.to, side: 1 };
}

const transient = EditorView.decorations.compute([pendingField, dropField], (state) => {
  const out: Range<Decoration>[] = [];
  state.field(pendingField).forEach((pending, i) => {
    const { at, side } = blockSpot(state, pending.pos);
    out.push(
      Decoration.widget({
        widget:
          pending.failed === undefined
            ? new UploadingWidget(pending.name)
            : new FailedWidget(pending.id, pending.name, pending.failed),
        block: true,
        side: side * (10 + i),
      }).range(at),
    );
  });
  const drop = state.field(dropField);
  if (drop !== null) {
    const { at, side } = blockSpot(state, drop);
    out.push(
      Decoration.widget({ widget: new DropCursorWidget(), block: true, side: side * 5 }).range(at),
    );
  }
  return Decoration.set(out, true);
});

/** Uploads `files` in order, each going in on a line of its own at `at` as it is done. */
export function uploadFiles(view: EditorView, files: readonly File[], at: number): void {
  const upload = view.state.facet(uploadFunction);
  if (upload === null || view.state.readOnly || files.length === 0) return;
  const items = files.map((file) => ({ id: pendingId(), pos: at, name: file.name }));
  view.dispatch({ effects: items.map((item) => addPending.of(item)) });
  const outcomes = files.map((file) => upload(file));
  void (async () => {
    for (const [i, item] of items.entries()) {
      const outcome = await outcomes[i];
      const current = view.state.field(pendingField).find((p) => p.id === item.id);
      if (outcome === undefined || current === undefined) continue;
      if (!outcome.ok) {
        view.dispatch({ effects: failPending.of({ id: item.id, message: outcome.message }) });
        continue;
      }
      const { doc } = view.state;
      const pos = current.pos;
      const lead = pos === 0 || doc.sliceString(pos - 1, pos) === "\n" ? "" : "\n";
      const trail = pos === doc.length || doc.sliceString(pos, pos + 1) === "\n" ? "" : "\n";
      view.dispatch({
        changes: { from: pos, insert: `${lead}${imageMarkdown(outcome.reference)}${trail}` },
        effects: dropPending.of(item.id),
        annotations: isolateHistory.of("full"),
        userEvent: "input.image",
      });
    }
  })();
}

const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes("Files") ?? false;

const fileEvents = EditorView.domEventHandlers({
  paste(event, view) {
    const data = event.clipboardData;
    if (data === null || view.state.facet(uploadFunction) === null) return false;
    // Text wins: cells copied from a spreadsheet come with a picture of themselves too.
    if (data.getData("text/plain") !== "") return false;
    const files = [...data.files];
    if (files.length === 0) return false;
    event.preventDefault();
    uploadFiles(view, files, view.state.selection.main.head);
    return true;
  },
  dragover(event, view) {
    if (!hasFiles(event) || view.state.facet(uploadFunction) === null) return false;
    event.preventDefault();
    if (view.state.readOnly) return true;
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos !== null && pos !== view.state.field(dropField)) {
      view.dispatch({ effects: setDropAt.of(pos) });
    }
    return true;
  },
  dragleave(event, view) {
    if (event.relatedTarget instanceof Node && view.dom.contains(event.relatedTarget)) return false;
    if (view.state.field(dropField) !== null) view.dispatch({ effects: setDropAt.of(null) });
    return false;
  },
  drop(event, view) {
    if (!hasFiles(event) || view.state.facet(uploadFunction) === null) return false;
    event.preventDefault();
    const at = view.state.field(dropField) ?? view.state.selection.main.head;
    view.dispatch({ effects: setDropAt.of(null) });
    uploadFiles(view, [...(event.dataTransfer?.files ?? [])], at);
    return true;
  },
});

/** What a side needs for Images: its upload function, and the widgets of uploads and drops. */
export function imageUploads(upload: Upload | null): Extension {
  return [
    uploadFunction.of(upload),
    pendingField,
    dropField,
    transient,
    fileEvents,
    EditorView.editorAttributes.compute([dropField], (state) => ({
      class: state.field(dropField) === null ? "" : "cm-lp-dragover",
    })),
  ];
}

/** The Image file a URL names, for a reference to one. */
const imageFile = (url: string) => /^images\/([\w-]+\.[A-Za-z0-9]+)$/.exec(url)?.[1];

const svgs = new Map<LucideIcon, string>();

/** An icon's SVG markup, kept. */
function svgOf(shape: LucideIcon): string {
  let svg = svgs.get(shape);
  if (svg === undefined) {
    svg = renderToStaticMarkup(
      createElement(shape, { "aria-hidden": true, size: 18, strokeWidth: 2 }),
    );
    svgs.set(shape, svg);
  }
  return svg;
}

function icon(svg: LucideIcon, className: string): HTMLElement {
  const el = document.createElement("span");
  el.className = className;
  el.setAttribute("aria-hidden", "true");
  el.innerHTML = svgOf(svg);
  return el;
}

function missingTile(url: string): HTMLElement {
  const tile = document.createElement("span");
  tile.className = "cm-lp-image-missing";
  tile.setAttribute("role", "img");
  tile.setAttribute("aria-label", "Missing image");
  const label = document.createElement("span");
  label.className = "cm-lp-image-missing-label";
  label.textContent = "Missing image";
  const name = document.createElement("span");
  name.className = "cm-lp-image-missing-name";
  name.textContent = url.replace(/^images\//, "");
  tile.append(icon(ImageOff, "cm-lp-image-missing-icon"), label, name);
  return tile;
}

/** The end of the Image reference the widget at `dom` stands for. */
function referenceEnd(view: EditorView, dom: HTMLElement): number | null {
  const start = view.posAtDOM(dom);
  const line = view.state.doc.lineAt(start);
  let end: number | null = null;
  treeOf(view.state).iterate({
    from: start,
    to: line.to,
    enter: (node) => {
      if (end !== null) return false;
      if (node.name === "Image" && node.from >= start) {
        end = node.to;
        return false;
      }
      return undefined;
    },
  });
  return end;
}

/**
 * An Image reference's picture, in place of its source while the cursor is
 * outside it: on lines of its own (`block`), or small, in a table's cell.
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
    if (protoState === "picture") box.classList.add("cm-lp-image-show");
    const frame = document.createElement("span");
    frame.className = "cm-lp-image-frame";
    const img = document.createElement("img");
    img.className = "cm-lp-image-img";
    img.alt = this.alt;
    img.src = imageSrc(this.url);
    const file = imageFile(this.url);
    img.addEventListener("error", () => {
      if (file === undefined) return;
      void isImageMissing(file).then((missing) => {
        if (missing) frame.replaceChildren(missingTile(this.url));
      });
    });
    frame.append(img);
    if (this.block) {
      const open = document.createElement("a");
      open.className = "cm-lp-image-open";
      open.href = imageSrc(this.url);
      open.target = "_blank";
      open.rel = "noopener";
      open.title = "Open full size";
      const label = document.createElement("span");
      label.className = "cm-lp-image-open-label";
      label.textContent = "Open full size";
      open.append(icon(SquareArrowOutUpRight, "cm-lp-image-open-icon"), label);
      open.addEventListener("mousedown", (event) => event.stopPropagation());
      frame.append(open);
    }
    // A click on the picture puts the cursor at the end of its source.
    box.addEventListener("mousedown", (event) => {
      if (event.target instanceof Element && event.target.closest("a") !== null) return;
      event.preventDefault();
      const end = referenceEnd(view, box);
      if (end === null) return;
      view.focus();
      view.dispatch({ selection: { anchor: end } });
    });
    box.append(frame);
    if (this.block) snapToLines(box, view);
    return box;
  }

  override destroy(dom: HTMLElement) {
    unsnap(dom);
  }

  override ignoreEvent() {
    return true;
  }
}

/** An upload on its way: a decoration, never text. */
class UploadingWidget extends WidgetType {
  constructor(readonly name: string) {
    super();
  }

  override eq(other: UploadingWidget) {
    return other.name === this.name;
  }

  toDOM(view: EditorView) {
    const box = document.createElement("div");
    box.className = "cm-lp-upload";
    const content = document.createElement("div");
    content.className = "cm-lp-upload-content";
    content.setAttribute("role", "status");
    const text = document.createElement("span");
    text.className = "cm-lp-upload-text";
    const verb = document.createElement("span");
    verb.className = "cm-lp-upload-verb";
    verb.textContent = "Uploading";
    const name = document.createElement("span");
    name.className = "cm-lp-upload-name";
    name.textContent = this.name;
    text.append(verb, " ", name);
    const bar = document.createElement("span");
    bar.className = "cm-lp-upload-bar";
    content.append(icon(LoaderCircle, "cm-lp-upload-icon"), text, bar);
    box.append(content);
    snapToLines(box, view);
    return box;
  }

  override destroy(dom: HTMLElement) {
    unsnap(dom);
  }
}

/** A failed or refused upload, in place, until it is dismissed. */
class FailedWidget extends WidgetType {
  constructor(
    readonly id: number,
    readonly name: string,
    readonly message: string,
  ) {
    super();
  }

  override eq(other: FailedWidget) {
    return other.id === this.id && other.message === this.message;
  }

  toDOM(view: EditorView) {
    const box = document.createElement("div");
    box.className = "cm-lp-failed";
    const content = document.createElement("div");
    content.className = "cm-lp-failed-content";
    content.setAttribute("role", "status");
    content.setAttribute("aria-live", "polite");
    const text = document.createElement("span");
    text.className = "cm-lp-failed-text";
    const name = document.createElement("span");
    name.className = "cm-lp-failed-name";
    name.textContent = this.name;
    const message = document.createElement("span");
    message.className = "cm-lp-failed-message";
    message.textContent = this.message;
    text.append(name, " ", message);
    const dismiss = document.createElement("button");
    dismiss.type = "button";
    dismiss.className = "cm-lp-failed-dismiss";
    dismiss.setAttribute("aria-label", `Dismiss: ${this.name} wasn't added`);
    dismiss.innerHTML = svgOf(X);
    dismiss.addEventListener("mousedown", (event) => event.preventDefault());
    dismiss.addEventListener("click", () => view.dispatch({ effects: dropPending.of(this.id) }));
    content.append(icon(TriangleAlert, "cm-lp-failed-icon"), text, dismiss);
    box.append(content);
    snapToLines(box, view);
    return box;
  }

  override destroy(dom: HTMLElement) {
    unsnap(dom);
  }

  override ignoreEvent() {
    return true;
  }
}

/** Where dragged files would go. */
class DropCursorWidget extends WidgetType {
  override eq() {
    return true;
  }

  toDOM() {
    const box = document.createElement("div");
    box.className = "cm-lp-drop";
    box.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    label.className = "cm-lp-drop-label";
    label.textContent = "Drop to add here";
    box.append(label);
    return box;
  }
}
