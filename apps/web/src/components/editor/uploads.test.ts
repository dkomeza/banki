import { IMAGE_FORMAT_MESSAGE } from "@banki/shared";
import { history, undo } from "@codemirror/commands";
import { EditorState, type Extension, Transaction, type TransactionSpec } from "@codemirror/state";
import { describe, expect, test, vi } from "vitest";
import { type UploadOutcome, uploadImage } from "@/lib/images";
import {
  finishUpload,
  fileUploads,
  ImageUploads,
  pastedFiles,
  pendingField,
  placeReference,
  startUploads,
  type Upload,
  uploadFiles,
} from "./uploads";

const ref = (id: string) => `![](images/${id}.png)`;

/** An editor holding `doc`, as uploadFiles sees one. */
function editor(doc: string, extensions: Extension) {
  const target = {
    state: EditorState.create({ doc, extensions }),
    dispatch(spec: TransactionSpec | Transaction) {
      target.state = spec instanceof Transaction ? spec.state : target.state.update(spec).state;
    },
  };
  return target;
}

/** Uploads that answer when told to, and what they heard. */
function controlledUploads() {
  const answers: ((outcome: UploadOutcome) => void)[] = [];
  const upload: Upload = () => new Promise((resolve) => answers.push(resolve));
  const heard = { uploading: [] as boolean[], failed: [] as string[] };
  const uploads = new ImageUploads(upload, {
    onUploading: (uploading) => heard.uploading.push(uploading),
    onFailed: (name, message) => heard.failed.push(`${name}: ${message}`),
    onCleared: () => {},
  });
  return { uploads, answers, heard };
}

const file = (name: string) => new File(["x"], name);
/** Lets the uploads waiting on answers go on. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const clipboard = (text: string, files: File[]) => ({
  getData: (type: string) => (type === "text/plain" ? text : ""),
  files,
});

describe("pastedFiles", () => {
  test("takes the files of a paste of files", () => {
    const image = file("a.png");
    expect(pastedFiles(clipboard("", [image]))).toEqual([image]);
  });

  test("takes none when the clipboard also holds plain text: the text wins", () => {
    expect(pastedFiles(clipboard("A1\tB1", [file("cells.png")]))).toEqual([]);
  });

  test("takes none from a paste of text alone", () => {
    expect(pastedFiles(clipboard("words", []))).toEqual([]);
  });
});

/** `doc` with a reference placed at `pos`, in a side or a table's cell (`inline`). */
const placed = (doc: string, pos: number, inline = false) => {
  const state = EditorState.create({ doc, extensions: fileUploads(null, inline) });
  return state.update({ changes: placeReference(state, pos, ref("a")) }).state.doc.toString();
};

describe("placeReference", () => {
  test("puts it on a line of its own at the point, breaking the line where it is mid-line", () => {
    expect(placed("ab", 1)).toBe(`a\n${ref("a")}\nb`);
    expect(placed("ab", 0)).toBe(`${ref("a")}\nab`);
    expect(placed("ab", 2)).toBe(`ab\n${ref("a")}`);
    expect(placed("", 0)).toBe(ref("a"));
    expect(placed("a\n\nb", 2)).toBe(`a\n${ref("a")}\nb`);
  });

  test("puts it inline at the point in a table's cell", () => {
    expect(placed("ab", 1, true)).toBe(`a${ref("a")}b`);
  });
});

describe("an upload's point", () => {
  test("follows edits made while the upload is on its way", () => {
    const view = editor("one two", fileUploads(null));
    const { items, effects } = startUploads(["a.png"], 3);
    view.dispatch({ effects });
    view.dispatch({ changes: { from: 0, insert: "zero " } });
    view.dispatch({ changes: { from: 0, to: 2, insert: "" } });

    view.dispatch(finishUpload(view.state, items[0]?.id ?? 0, "images/a.png") ?? {});

    expect(view.state.doc.toString()).toBe(`ro one\n${ref("a")}\n two`);
    expect(view.state.field(pendingField)).toEqual([]);
  });

  test("goes in as one undo step, leaving what was typed meanwhile", () => {
    const view = editor("text", [history(), fileUploads(null)]);
    const { items, effects } = startUploads(["a.png"], 4);
    view.dispatch({ effects });
    view.dispatch({ changes: { from: 0, insert: "my " }, userEvent: "input.type" });
    view.dispatch(finishUpload(view.state, items[0]?.id ?? 0, "images/a.png") ?? {});
    expect(view.state.doc.toString()).toBe(`my text\n${ref("a")}`);

    undo(view);

    expect(view.state.doc.toString()).toBe("my text");
  });
});

describe("uploadFiles", () => {
  test("puts several in, in the order given, however they finish, holding until all are in", async () => {
    const { uploads, answers, heard } = controlledUploads();
    const view = editor("Before\nAfter", fileUploads(uploads));

    const done = uploadFiles(view, [file("a.png"), file("b.png")], 6);
    expect(view.state.field(pendingField).map((p) => p.name)).toEqual(["a.png", "b.png"]);
    expect(heard.uploading).toEqual([true]);
    answers[1]?.({ ok: true, reference: "images/b.png" });
    await settle();
    expect(view.state.doc.toString()).toBe("Before\nAfter");
    answers[0]?.({ ok: true, reference: "images/a.png" });
    await done;

    expect(view.state.doc.toString()).toBe(`Before\n${ref("a")}\n${ref("b")}\nAfter`);
    expect(heard.uploading).toEqual([true, false]);
  });

  test("turns a failed one into an error tile in place, nothing in the text, the others going on", async () => {
    const { uploads, answers, heard } = controlledUploads();
    const view = editor("text", fileUploads(uploads));

    const done = uploadFiles(view, [file("notes.pdf"), file("b.png")], 4);
    answers[0]?.({ ok: false, message: IMAGE_FORMAT_MESSAGE });
    answers[1]?.({ ok: true, reference: "images/b.png" });
    await done;

    expect(view.state.doc.toString()).toBe(`text\n${ref("b")}`);
    expect(view.state.field(pendingField)).toEqual([
      expect.objectContaining({ name: "notes.pdf", failed: IMAGE_FORMAT_MESSAGE }),
    ]);
    expect(heard.failed).toEqual([`notes.pdf: ${IMAGE_FORMAT_MESSAGE}`]);
    // An error tile doesn't hold anything.
    expect(heard.uploading).toEqual([true, false]);
  });

  test("refuses a file that isn't an Image with the API's message, before uploading it", async () => {
    const fetch = vi.fn();
    const uploads = new ImageUploads((f) => uploadImage(f), {
      onUploading: () => {},
      onFailed: () => {},
      onCleared: () => {},
    });
    const view = editor("", fileUploads(uploads));
    vi.stubGlobal("fetch", fetch);

    await uploadFiles(view, [new File(["plain words"], "notes.txt", { type: "text/plain" })], 0);
    vi.unstubAllGlobals();

    expect(view.state.doc.toString()).toBe("");
    expect(view.state.field(pendingField)).toEqual([
      expect.objectContaining({ name: "notes.txt", failed: IMAGE_FORMAT_MESSAGE }),
    ]);
    expect(fetch).not.toHaveBeenCalled();
  });

  test("does nothing while the editor is read-only, or without uploads", async () => {
    const { uploads } = controlledUploads();
    const readOnly = editor("", [fileUploads(uploads), EditorState.readOnly.of(true)]);
    const none = editor("", fileUploads(null));

    await uploadFiles(readOnly, [file("a.png")], 0);
    await uploadFiles(none, [file("a.png")], 0);

    expect(readOnly.state.field(pendingField)).toEqual([]);
    expect(none.state.field(pendingField)).toEqual([]);
  });
});
