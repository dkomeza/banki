import { Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { type RefObject, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { livePreview } from "./live-preview";
import "./live-preview.css";

// The live-preview editor as a React component, with nothing card-specific in
// it: a value, a label, an error and a note, like the textarea it replaces.

export function LiveEditor({
  value,
  onChange,
  placeholder,
  labelledBy,
  describedBy,
  invalid,
  readOnly,
  autoFocus,
  initialCursor,
  className,
  viewRef,
  onFocus,
  onCursor,
  onSubmit,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  labelledBy: string;
  describedBy?: string;
  invalid?: boolean;
  readOnly?: boolean;
  autoFocus?: boolean;
  /** Where the cursor starts, when it isn't at the start. */
  initialCursor?: number;
  className?: string;
  viewRef?: RefObject<EditorView | null>;
  onFocus?: () => void;
  onCursor?: (cursor: number) => void;
  onSubmit: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const handlers = useRef({ onChange, onFocus, onCursor, onSubmit });
  handlers.current = { onChange, onFocus, onCursor, onSubmit };
  const attrs = useRef(new Compartment());
  const editable = useRef(new Compartment());

  const attributes = () => {
    const out: Record<string, string> = { "aria-labelledby": labelledBy };
    if (describedBy) out["aria-describedby"] = describedBy;
    if (invalid) out["aria-invalid"] = "true";
    return EditorView.contentAttributes.of(out);
  };

  useEffect(() => {
    if (!host.current) return;
    const created = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        selection: initialCursor === undefined ? undefined : { anchor: initialCursor },
        extensions: [
          livePreview({ placeholder, onSubmit: () => handlers.current.onSubmit() }),
          attrs.current.of(attributes()),
          editable.current.of(EditorState.readOnly.of(readOnly ?? false)),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) handlers.current.onChange(update.state.doc.toString());
            if (update.selectionSet || update.docChanged) {
              handlers.current.onCursor?.(update.state.selection.main.head);
            }
            if (update.focusChanged && update.view.hasFocus) handlers.current.onFocus?.();
          }),
        ],
      }),
    });
    view.current = created;
    // Variant-only: lets a script read the side's source.
    Reflect.set(host.current, "lpView", created);
    if (viewRef) viewRef.current = created;
    if (autoFocus) requestAnimationFrame(() => created.focus());
    return () => {
      created.destroy();
      view.current = null;
      if (viewRef) viewRef.current = null;
    };
    // Created once; later changes reach it through the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const current = view.current;
    if (!current || current.state.doc.toString() === value) return;
    current.dispatch({ changes: { from: 0, to: current.state.doc.length, insert: value } });
  }, [value]);

  useEffect(() => {
    view.current?.dispatch({
      effects: [
        attrs.current.reconfigure(attributes()),
        editable.current.reconfigure(EditorState.readOnly.of(readOnly ?? false)),
      ],
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [labelledBy, describedBy, invalid, readOnly]);

  return <div ref={host} className={cn("live-editor card-text", className)} />;
}
