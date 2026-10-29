import type { AutoClose } from "@banki/shared";
import { Annotation, Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { type RefObject, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import type { Format } from "./formatting";
import { imageUploads, type Upload, uploadFiles, uploadingCount } from "./images";
import { applyFormat, livePreview } from "./live-preview";
import { smallestChange } from "./table-model";
import { EditorToolbar } from "./toolbar";
import { useKeyboardInset } from "./use-keyboard-inset";
import "./live-editor.css";

// The live-preview editor as a React field, with nothing about Cards in it:
// a value and its changes, a label, an error and a note to describe it, like
// the textarea it replaces, and its formatting toolbar.

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
  onCursor,
  onSubmit,
  onUpload,
  onUploading,
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
  /** Called with where the cursor is, as the User moves it or types. */
  onCursor?: (cursor: number) => void;
  /** What Ctrl/Cmd+Enter does. */
  onSubmit: () => void;
  /** Uploads a file as an Image. Without it, the editor takes no files. */
  onUpload?: Upload;
  /** Called with how many uploads are on their way, as that changes. */
  onUploading?: (count: number) => void;
}) {
  useKeyboardInset();
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const reconfigure = useRef<ReturnType<typeof livePreview>["reconfigure"]>(null);
  const attributes = useRef(new Compartment());
  /** The table cell written in last, while the focus is in the editor. */
  const cell = useRef<EditorView | null>(null);
  const handlers = useRef({ onChange, onCursor, onSubmit, onUploading });
  handlers.current = { onChange, onCursor, onSubmit, onUploading };

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
    const made = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          preview.extension,
          attributes.current.of(aria()),
          imageUploads(onUpload ?? null),
          EditorView.updateListener.of((update) => {
            const before = uploadingCount(update.startState);
            const after = uploadingCount(update.state);
            if (before !== after) handlers.current.onUploading?.(after);
            const typed = update.transactions.some((tr) => tr.annotation(fromValue) !== true);
            if (update.docChanged && typed) handlers.current.onChange(update.state.doc.toString());
            if ((update.selectionSet || update.docChanged) && typed) {
              handlers.current.onCursor?.(update.state.selection.main.head);
            }
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
        onImages={
          onUpload === undefined
            ? undefined
            : (files) => {
                const current = view.current;
                if (current === null) return;
                uploadFiles(current, files, current.state.selection.main.head);
                current.focus();
              }
        }
      />
    </div>
  );
}
