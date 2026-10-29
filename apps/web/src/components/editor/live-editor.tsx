import type { AutoClose } from "@banki/shared";
import { Annotation, Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { type RefObject, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Cheatsheet } from "./cheatsheet";
import type { Format } from "./formatting";
import { insertAtCursor } from "./latex-complete";
import type { LatexCommand } from "./latex-commands";
import { applyFormat, livePreview } from "./live-preview";
import { smallestChange } from "./table-model";
import { EditorToolbar } from "./toolbar";
import { fileUploads, ImageUploads, type Upload, uploadFiles } from "./uploads";
import { useKeyboardInset } from "./use-keyboard-inset";
import "./live-editor.css";
import "./latex.css";

// The live-preview editor as a React field, with nothing about Cards in it:
// a value and its changes, a label, an error and a note to describe it, like
// the textarea it replaces, and its formatting toolbar. Given an upload, it
// takes Images too: pasted, dropped, or picked with the toolbar's Image
// button; without one, it ignores files.

/** Marks a change that came in through `value`, which isn't the User's. */
const fromValue = Annotation.define<boolean>();

export function LiveEditor({
  value,
  onChange,
  placeholder,
  labelledBy,
  describedBy,
  invalid = false,
  readOnly = false,
  autoFocus = false,
  autoClose,
  toolbarLabel,
  className,
  viewRef,
  onFocus,
  onSubmit,
  onUpload,
  onUploading,
  protoCheatsheet,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  /** The ID of the element that labels it. */
  labelledBy: string;
  /** The IDs of the elements that describe it, such as its error. */
  describedBy?: string;
  invalid?: boolean;
  readOnly?: boolean;
  autoFocus?: boolean;
  autoClose: AutoClose;
  /** Names the formatting toolbar, such as "Front formatting". */
  toolbarLabel: string;
  className?: string;
  /** Set to the editor while it is on the page. */
  viewRef?: RefObject<EditorView | null>;
  /** Called as the focus comes into the editor, its table cells or its toolbar. */
  onFocus?: () => void;
  /** What Ctrl/Cmd+Enter does. */
  onSubmit: () => void;
  /** Uploads a file as an Image. Read once, as the editor is made. */
  onUpload?: Upload;
  /** Called with whether an upload is on its way, as that changes. */
  onUploading?: (uploading: boolean) => void;
  /** Prototype only: opens the cheatsheet with this query as the page loads. */
  protoCheatsheet?: string;
}) {
  useKeyboardInset();
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const reconfigure = useRef<ReturnType<typeof livePreview>["reconfigure"]>(null);
  const attributes = useRef(new Compartment());
  /** The table cell written in last, while the focus is in the editor. */
  const cell = useRef<EditorView | null>(null);
  const handlers = useRef({ onChange, onSubmit, onUploading });
  handlers.current = { onChange, onSubmit, onUploading };
  /** What is announced of the uploads that failed, until their tiles go. */
  const [failures, setFailures] = useState<readonly { key: number; text: string }[]>([]);
  const [takesFiles] = useState(onUpload !== undefined);
  /** The cheatsheet's search, while it is open. */
  const [cheatsheet, setCheatsheet] = useState<string | null>(protoCheatsheet ?? null);

  /** Where the focus goes back to, and an entry goes in: the cell written in, or the side. */
  const writtenIn = () => cell.current ?? view.current;
  const closeCheatsheet = () => {
    setCheatsheet(null);
    writtenIn()?.focus();
  };
  const insert = (command: LatexCommand) => {
    const target = writtenIn();
    if (target !== null) insertAtCursor(target, command);
    // Variant b: the panel stays open, like a palette; the focus is in the side.
  };

  const aria = () =>
    EditorView.contentAttributes.of({
      "aria-labelledby": labelledBy,
      ...(describedBy === undefined ? {} : { "aria-describedby": describedBy }),
      ...(invalid ? { "aria-invalid": "true" } : {}),
    });

  // Made once; later props reach it through the effects below.
  useEffect(() => {
    if (host.current === null) return undefined;
    const preview = livePreview({
      placeholder,
      onSubmit: () => handlers.current.onSubmit(),
      autoClose,
      readOnly,
    });
    reconfigure.current = preview.reconfigure;
    const uploads =
      onUpload === undefined
        ? null
        : new ImageUploads(onUpload, {
            onUploading: (uploading) => handlers.current.onUploading?.(uploading),
            onFailed: (name, message) =>
              setFailures((current) => [
                ...current,
                { key: (current.at(-1)?.key ?? 0) + 1, text: `${name} wasn't added. ${message}` },
              ]),
            onCleared: () => setFailures([]),
          });
    const made = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          preview.extension,
          attributes.current.of(aria()),
          fileUploads(uploads),
          EditorView.updateListener.of((update) => {
            const typed = update.transactions.some((tr) => tr.annotation(fromValue) !== true);
            if (update.docChanged && typed) handlers.current.onChange(update.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = made;
    if (viewRef !== undefined) viewRef.current = made;
    if (autoFocus) made.focus();
    return () => {
      made.destroy();
      view.current = null;
      if (viewRef !== undefined) viewRef.current = null;
    };
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A value set from outside (an Image put in, the form cleared) changes only what differs.
  useEffect(() => {
    const current = view.current;
    if (current === null) return;
    const change = smallestChange(current.state.doc.toString(), value);
    if (change !== null) current.dispatch({ changes: change, annotations: fromValue.of(true) });
  }, [value]);

  useEffect(() => {
    const current = view.current;
    if (current === null || reconfigure.current === null) return;
    current.dispatch({
      effects: [
        ...reconfigure.current({ autoClose, readOnly }),
        attributes.current.reconfigure(aria()),
      ],
    });
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [autoClose, readOnly, labelledBy, describedBy, invalid]);

  const format = (to: Format) => {
    if (view.current !== null) applyFormat(view.current, to, cell.current);
  };

  /** The Image button's files, at the cursor of the cell written in, or of the side. */
  const pickImages = (files: File[]) => {
    const target = cell.current ?? view.current;
    if (target === null) return;
    target.focus();
    void uploadFiles(target, files, target.state.selection.main.head);
  };

  return (
    <div
      className={cn("live-editor", className)}
      onFocus={(event) => {
        // Where formatting goes: the cell written in, or the side itself.
        const editor = event.target.closest(".cm-editor");
        if (editor instanceof HTMLElement) {
          const found = EditorView.findFromDOM(editor);
          cell.current = found === view.current ? null : found;
        }
        onFocus?.();
      }}
    >
      <div ref={host} className="live-editor-host" />
      <EditorToolbar
        label={toolbarLabel}
        disabled={readOnly}
        onFormat={format}
        onImages={takesFiles ? pickImages : undefined}
        cheatsheetOpen={cheatsheet !== null}
        onCheatsheet={() => (cheatsheet === null ? setCheatsheet("") : closeCheatsheet())}
      />
      {cheatsheet !== null && (
        <Cheatsheet
          query={cheatsheet}
          onQuery={setCheatsheet}
          onInsert={insert}
          onClose={closeCheatsheet}
        />
      )}
      {takesFiles && (
        // Always there, so each failure added to it is announced.
        <div aria-live="polite" className="sr-only">
          {failures.map((failure) => (
            <p key={failure.key}>{failure.text}</p>
          ))}
        </div>
      )}
    </div>
  );
}
