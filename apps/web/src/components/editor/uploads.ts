import { imageMarkdown } from "@banki/shared";
import { isolateHistory } from "@codemirror/commands";
import {
  type ChangeSpec,
  type EditorState,
  type Extension,
  Facet,
  type Range,
  StateEffect,
  StateField,
  type TransactionSpec,
} from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import { LoaderCircle, TriangleAlert, X } from "lucide-react";
import { onOwnLine, type UploadOutcome } from "@/lib/images";
import { iconElement, svgOf } from "./icons";
import { snapToLines, unsnap } from "./widgets";

// Files into the editor: pasted, dropped, or picked with the toolbar's Image
// button, each uploaded and its reference put in where it was given, on a line
// of its own (inline in a table's cell). While it uploads, a widget stands at
// that point, which follows edits made meanwhile; the text changes only when
// the reference arrives, as one undo step. One that fails turns into an error
// tile there until it is dismissed. Nothing here is about Cards: the editor
// takes files only when it is given an upload.

/** Uploads a file as an Image. */
export type Upload = (file: File) => Promise<UploadOutcome>;

/**
 * An editor's uploads, shared by the side and its table's cells: the upload,
 * and how many are on their way, which holds whatever waits on them.
 */
export class ImageUploads {
  private pending = 0;

  constructor(
    readonly upload: Upload,
    private readonly listener: {
      /** Hears whether any upload is on its way, as that changes. */
      onUploading: (uploading: boolean) => void;
      /** Hears of each upload that failed, to announce it. */
      onFailed: (name: string, message: string) => void;
      /** Hears that every error tile went. */
      onCleared: () => void;
    },
  ) {}

  started(count: number): void {
    if (this.pending === 0 && count > 0) this.listener.onUploading(true);
    this.pending += count;
  }

  finished(): void {
    this.pending -= 1;
    if (this.pending === 0) this.listener.onUploading(false);
  }

  failed(name: string, message: string): void {
    this.listener.onFailed(name, message);
  }

  cleared(): void {
    this.listener.onCleared();
  }
}

/** The editor's uploads; an editor without them takes no files. */
export const imageUploads = Facet.define<ImageUploads | null, ImageUploads | null>({
  combine: (values) => values[0] ?? null,
});

/** Whether an Image goes in inline at its point, as in a table's one-line cell. */
const inlineImages = Facet.define<boolean, boolean>({
  combine: (values) => values.some(Boolean),
});

/** An upload on its way, or one that failed, at the point its reference goes in. */
export type Pending = { id: number; pos: number; name: string; failed?: string };

const addPending = StateEffect.define<Pending>();
const failPending = StateEffect.define<{ id: number; message: string }>();
const dropPending = StateEffect.define<number>();
/** Takes every error tile away: the form saved or cleared. */
const clearFailures = StateEffect.define();

/**
 * The uploads on their way and the failures, in the order they were given.
 * Each one's point moves with the edits around it, staying after text typed
 * right at it, so several given at one point keep their order.
 */
export const pendingField = StateField.define<readonly Pending[]>({
  create: () => [],
  update(value, tr) {
    let next = tr.docChanged
      ? value.map((pending) => ({ ...pending, pos: tr.changes.mapPos(pending.pos, 1) }))
      : value;
    for (const effect of tr.effects) {
      if (effect.is(addPending)) next = [...next, effect.value];
      else if (effect.is(failPending)) {
        const { id, message } = effect.value;
        next = next.map((pending) =>
          pending.id === id ? { ...pending, failed: message } : pending,
        );
      } else if (effect.is(dropPending))
        next = next.filter((pending) => pending.id !== effect.value);
      else if (effect.is(clearFailures))
        next = next.filter((pending) => pending.failed === undefined);
    }
    return next;
  },
});

/** Where files dragged over the editor would go, while they are. */
const setDropAt = StateEffect.define<number | null>();

const dropField = StateField.define<number | null>({
  create: () => null,
  update(value, tr) {
    let next = value === null || !tr.docChanged ? value : tr.changes.mapPos(value);
    for (const effect of tr.effects) if (effect.is(setDropAt)) next = effect.value;
    return next;
  },
});

/**
 * The change that puts `markdown` in at `pos`: on a line of its own, or as it
 * is in a table's cell, which holds no line break.
 */
export function placeReference(state: EditorState, pos: number, markdown: string): ChangeSpec {
  if (state.facet(inlineImages)) return { from: pos, insert: markdown };
  const { doc } = state;
  return {
    from: pos,
    insert: onOwnLine(doc.sliceString(pos - 1, pos), doc.sliceString(pos, pos + 1), markdown),
  };
}

let ids = 0;

/** Starts uploads of `files`, named in that order, at `pos`. */
export function startUploads(names: readonly string[], pos: number) {
  const items = names.map((name) => ({ id: ++ids, pos, name }));
  return { items, effects: items.map((item) => addPending.of(item)) };
}

/**
 * The transaction that puts the reference of the upload `id` in where its
 * point is now, as one undo step, or null when it has gone.
 */
export function finishUpload(
  state: EditorState,
  id: number,
  reference: string,
): TransactionSpec | null {
  const pending = state.field(pendingField).find((p) => p.id === id);
  if (pending === undefined) return null;
  return {
    changes: placeReference(state, pending.pos, imageMarkdown(reference)),
    effects: dropPending.of(id),
    annotations: isolateHistory.of("full"),
    userEvent: "input.image",
  };
}

/** Turns the upload `id` into an error tile saying `message`. */
export const failUpload = (id: number, message: string) => failPending.of({ id, message });

/** What {@link uploadFiles} needs of an editor: an EditorView. */
type Target = { readonly state: EditorState; dispatch: (spec: TransactionSpec) => void };

const NOT_UPLOADED = "Banki couldn't upload the image. Try again.";

/**
 * Uploads `files` at once, putting each one's reference in at `pos` as it is
 * done, in the order given: one that finishes early waits for those before
 * it. One that fails turns into an error tile, and the others go on. Nothing
 * happens without uploads or while the editor is read-only.
 */
export async function uploadFiles(view: Target, files: readonly File[], pos: number) {
  const uploads = view.state.facet(imageUploads);
  if (uploads === null || view.state.readOnly || files.length === 0) return;
  const { items, effects } = startUploads(
    files.map((file) => file.name),
    pos,
  );
  view.dispatch({ effects });
  uploads.started(items.length);
  const outcomes = files.map((file) =>
    uploads.upload(file).catch((): UploadOutcome => ({ ok: false, message: NOT_UPLOADED })),
  );
  for (const [i, item] of items.entries()) {
    const outcome = (await outcomes[i]) ?? { ok: false, message: NOT_UPLOADED };
    if (outcome.ok) {
      const spec = finishUpload(view.state, item.id, outcome.reference);
      if (spec !== null) view.dispatch(spec);
    } else {
      view.dispatch({ effects: failUpload(item.id, outcome.message) });
      uploads.failed(item.name, outcome.message);
    }
    uploads.finished();
  }
}

/** Takes every error tile away from `view` and its table's cells. */
export function clearUploadFailures(view: EditorView): void {
  const editors = [view.dom, ...view.contentDOM.querySelectorAll<HTMLElement>(".cm-editor")];
  for (const dom of editors) {
    const editor = EditorView.findFromDOM(dom);
    if (editor !== null && editor.state.field(pendingField, false)?.some((p) => p.failed)) {
      editor.dispatch({ effects: clearFailures.of(null) });
    }
  }
  view.state.facet(imageUploads)?.cleared();
}

/**
 * The files a paste gives, if it is one of files: when the clipboard also
 * holds plain text, the text wins, so cells copied from a spreadsheet, which
 * come with a picture of themselves, still paste as text.
 */
export function pastedFiles(
  data: Pick<DataTransfer, "getData"> & { files: Iterable<File> },
): File[] {
  if (data.getData("text/plain") !== "") return [];
  return [...data.files];
}

const draggingFiles = (event: DragEvent) => event.dataTransfer?.types.includes("Files") ?? false;

/** Whether the editor would take files dropped on it now. */
const takesFiles = (state: EditorState) => state.facet(imageUploads) !== null && !state.readOnly;

/**
 * Pasted and dropped files. Any file is an Image attempt: none is ever put
 * in as text. An editor that takes no files ignores them.
 */
const fileEvents = EditorView.domEventHandlers({
  paste(event, view) {
    if (event.clipboardData === null) return false;
    const files = pastedFiles(event.clipboardData);
    if (files.length === 0) return false;
    event.preventDefault();
    void uploadFiles(view, files, view.state.selection.main.head);
    return true;
  },
  dragover(event, view) {
    if (!draggingFiles(event)) return false;
    event.preventDefault();
    if (!takesFiles(view.state)) {
      if (event.dataTransfer !== null) event.dataTransfer.dropEffect = "none";
      return true;
    }
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos !== null && pos !== view.state.field(dropField)) {
      view.dispatch({ effects: setDropAt.of(pos) });
    }
    return true;
  },
  dragleave(event, view) {
    if (view.state.field(dropField) === null) return false;
    // Only on leaving the editor, not on passing from one of its lines to the next.
    const box = view.dom.getBoundingClientRect();
    const inside =
      event.clientX > box.left &&
      event.clientX < box.right &&
      event.clientY > box.top &&
      event.clientY < box.bottom;
    if (!inside) view.dispatch({ effects: setDropAt.of(null) });
    return false;
  },
  drop(event, view) {
    if (!draggingFiles(event)) return false;
    event.preventDefault();
    const at =
      view.state.field(dropField) ??
      view.posAtCoords({ x: event.clientX, y: event.clientY }) ??
      view.state.selection.main.head;
    view.dispatch({ effects: setDropAt.of(null) });
    void uploadFiles(view, [...(event.dataTransfer?.files ?? [])], at);
    return true;
  },
});

/**
 * Where a block drawn at `pos` sits: over the line when `pos` starts one with
 * text on it, else under the line, as the reference will.
 */
function blockSpot(state: EditorState, pos: number): { at: number; side: -1 | 1 } {
  const line = state.doc.lineAt(pos);
  if (pos === line.from && line.length > 0) return { at: line.from, side: -1 };
  return { at: line.to, side: 1 };
}

/** The widgets of the uploads, the failures and the drop cursor. */
const transientWidgets = EditorView.decorations.compute([pendingField, dropField], (state) => {
  const inline = state.facet(inlineImages);
  const out: Range<Decoration>[] = [];
  const place = (pos: number, widget: WidgetType, order: number) => {
    if (inline) {
      out.push(Decoration.widget({ widget, side: order }).range(pos));
      return;
    }
    const { at, side } = blockSpot(state, pos);
    out.push(Decoration.widget({ widget, block: true, side: side * order }).range(at));
  };
  state.field(pendingField).forEach((pending, i) => {
    place(
      pending.pos,
      pending.failed === undefined
        ? new UploadingWidget(pending.name, inline)
        : new FailedWidget(pending.id, pending.name, pending.failed, inline),
      10 + i,
    );
  });
  const drop = state.field(dropField);
  if (drop !== null) place(drop, new DropCursorWidget(inline), 5);
  return Decoration.set(out, true);
});

/**
 * What an editor needs to take files: `uploads`, or null for one that takes
 * none and ignores them. `inline` is a table's cell, where an Image goes in
 * inline at its point.
 */
export function fileUploads(uploads: ImageUploads | null, inline = false): Extension {
  return [
    imageUploads.of(uploads),
    inlineImages.of(inline),
    pendingField,
    dropField,
    transientWidgets,
    fileEvents,
  ];
}

/** Text only assistive tech reads. */
function hiddenText(text: string): HTMLElement {
  const el = document.createElement("span");
  el.className = "cm-lp-sr";
  el.textContent = text;
  return el;
}

/**
 * A chip (`inline`, in a cell), or a chip centred on a line of its own in a
 * box kept to whole lines, so the text after it stays on its rules.
 */
function chipBox(chip: HTMLElement, inline: boolean, view: EditorView): HTMLElement {
  if (inline) return chip;
  const box = document.createElement("div");
  box.className = "cm-lp-chip-line";
  box.append(chip);
  snapToLines(box, view);
  return box;
}

/** An upload on its way: a decoration, never text. */
class UploadingWidget extends WidgetType {
  constructor(
    readonly name: string,
    readonly inline: boolean,
  ) {
    super();
  }

  override eq(other: UploadingWidget) {
    return other.name === this.name && other.inline === this.inline;
  }

  toDOM(view: EditorView) {
    const chip = document.createElement("span");
    chip.className = "cm-lp-chip cm-lp-uploading";
    const name = document.createElement("span");
    name.className = "cm-lp-chip-name";
    name.textContent = this.name;
    const bar = document.createElement("span");
    bar.className = "cm-lp-uploading-bar";
    chip.append(
      iconElement(LoaderCircle, "cm-lp-chip-icon cm-lp-uploading-icon"),
      hiddenText("Uploading "),
      name,
      bar,
    );
    return chipBox(chip, this.inline, view);
  }

  override destroy(dom: HTMLElement) {
    unsnap(dom);
  }
}

/** A failed or refused upload, in place until it is dismissed. */
class FailedWidget extends WidgetType {
  constructor(
    readonly id: number,
    readonly name: string,
    readonly message: string,
    readonly inline: boolean,
  ) {
    super();
  }

  override eq(other: FailedWidget) {
    return other.id === this.id && other.message === this.message && other.inline === this.inline;
  }

  toDOM(view: EditorView) {
    const chip = document.createElement("span");
    chip.className = "cm-lp-chip cm-lp-failed";
    const text = document.createElement("span");
    text.className = "cm-lp-failed-text";
    const name = document.createElement("span");
    name.className = "cm-lp-chip-name";
    name.textContent = this.name;
    const message = document.createElement("span");
    message.textContent = this.message;
    text.append(hiddenText("Not added: "), name, " · ", message);
    const dismiss = document.createElement("button");
    dismiss.type = "button";
    dismiss.className = "cm-lp-failed-dismiss";
    dismiss.setAttribute("aria-label", `Dismiss: ${this.name} wasn't added`);
    dismiss.innerHTML = svgOf(X);
    // Keeps the cursor where it was.
    dismiss.addEventListener("mousedown", (event) => event.preventDefault());
    dismiss.addEventListener("click", () => view.dispatch({ effects: dropPending.of(this.id) }));
    chip.append(iconElement(TriangleAlert, "cm-lp-chip-icon"), text, dismiss);
    return chipBox(chip, this.inline, view);
  }

  override destroy(dom: HTMLElement) {
    unsnap(dom);
  }

  // Its × takes its own clicks.
  override ignoreEvent() {
    return true;
  }
}

/** Where dragged files would go: a rule between lines, or a caret in a cell. */
class DropCursorWidget extends WidgetType {
  constructor(readonly inline: boolean) {
    super();
  }

  override eq(other: DropCursorWidget) {
    return other.inline === this.inline;
  }

  toDOM() {
    const el = document.createElement(this.inline ? "span" : "div");
    el.className = this.inline ? "cm-lp-drop-caret" : "cm-lp-drop";
    el.setAttribute("aria-hidden", "true");
    if (!this.inline) {
      const label = document.createElement("span");
      label.className = "cm-lp-drop-label";
      label.textContent = "Drop to add here";
      el.append(label);
    }
    return el;
  }
}
