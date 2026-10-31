import { DEFAULT_AUTO_CLOSE } from "@banki/shared";
import type { EditorView } from "@codemirror/view";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Copy, Plus } from "lucide-react";
import {
  type FormEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { LiveEditor } from "@/components/editor/live-editor";
import { clearUploadFailures } from "@/components/editor/uploads";
import { Breadcrumb } from "@/components/folders/breadcrumb";
import { useLibrary } from "@/components/folders/use-library";
import { Page } from "@/components/page";
import { TagField, type TagInput } from "@/components/cards/tag-field";
import { CardLine } from "@/components/cards/card-text";
import { PILL } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import {
  type Card,
  type CardFields,
  type FieldErrors,
  cardsQueryOptions,
  duplicatesOf,
  hasUnsavedChanges,
} from "@/lib/cards";
import type { Deck } from "@/lib/decks";
import { uploadImage } from "@/lib/images";
import { settingsQueryOptions } from "@/lib/settings";
import { cn } from "@/lib/utils";

// New card and Edit card are one writing page: a dated page with the two
// sides written on ruled lines inside a bordered card, their labels in the
// margin from 640 px, then the Grading notes the same way (behind "Add grading
// notes" until a Card has them), the Tags field under them, and the actions
// along the card's foot under a hairline. Images go into a side through its
// editor, never into the notes.

/** A Card's sides, the fields that take Images. */
type Side = "front" | "back";

/**
 * The form's state: the fields as typed, what counts as saved, each field's
 * error, whether the Grading notes are open, and whether an Image is on its
 * way up into either side. `onChange` hears of every change to a field, typed
 * or an Image put in.
 */
export function useCardForm(saved0: CardFields, { onChange }: { onChange?: () => void } = {}) {
  const [fields, setFields] = useState(saved0);
  const [saved, setSaved] = useState(saved0);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [uploading, setUploading] = useState({ front: false, back: false });
  // Open on a Card that has notes; once opened, open until the page is left.
  const [notesOpen, setNotesOpen] = useState(saved0.gradingNotes !== "");
  const frontRef = useRef<EditorView>(null);
  const backRef = useRef<EditorView>(null);
  const notesRef = useRef<EditorView>(null);
  const latest = useRef(saved0);
  const set = (field: keyof CardFields, value: string) => {
    latest.current = { ...latest.current, [field]: value };
    setFields(latest.current);
    setErrors((current) => ({ ...current, [field]: undefined }));
    onChange?.();
  };
  return {
    fields,
    errors,
    frontRef,
    backRef,
    notesRef,
    unsaved: hasUnsavedChanges(fields, saved),
    /** Changes one field, clearing its error. */
    set,
    /** Whether the Grading notes' field shows, rather than "Add grading notes". */
    notesOpen,
    openNotes: () => setNotesOpen(true),
    setErrors,
    /**
     * Marks `next` as saved and shows it, so leaving doesn't ask, and takes
     * away the error tiles of uploads that failed.
     */
    markSaved: (next: CardFields) => {
      latest.current = next;
      for (const view of [frontRef.current, backRef.current]) {
        if (view !== null) clearUploadFailures(view);
      }
      setSaved(next);
      setFields(next);
      setErrors({});
    },
    /** Whether an Image is on its way up, which holds Save. */
    uploading: uploading.front || uploading.back,
    /** Notes whether an Image is on its way up into `side`. */
    setUploading: (side: Side, now: boolean) =>
      setUploading((current) => ({ ...current, [side]: now })),
  };
}

export type CardForm = ReturnType<typeof useCardForm>;

/** Ctrl+Enter, or Cmd+Enter on a Mac, the shortcut that saves. */
const SAVE_KEY =
  typeof navigator !== "undefined" && /Mac|iP/.test(navigator.platform) ? "⌘" : "Ctrl";

/** One field on ruled lines, its label in the margin from 640 px. */
export function Field({
  label,
  placeholder,
  value,
  error,
  note,
  inputRef,
  autoFocus,
  readOnly,
  onChange,
  onSubmit,
  onUploading,
  className,
}: {
  label: "Front" | "Back" | "Grading notes";
  readOnly: boolean;
  placeholder: string;
  value: string;
  error: string | undefined;
  /** A note under the field, announced politely: the Duplicate warning. */
  note?: ReactNode;
  inputRef: RefObject<EditorView | null>;
  autoFocus?: boolean;
  onChange: (value: string) => void;
  /** Ctrl/Cmd+Enter. */
  onSubmit: () => void;
  /** Hears whether an Image is on its way up into it; without it, it takes no Images. */
  onUploading?: (uploading: boolean) => void;
  className?: string;
}) {
  const id = useId();
  const size =
    label === "Front"
      ? "min-h-16 text-xl/[2rem] font-semibold tracking-tight"
      : label === "Back"
        ? "min-h-32 text-[1.05rem]/[2rem]"
        : "min-h-16 text-[0.95rem]/[2rem]";
  const autoClose = useQuery(settingsQueryOptions()).data?.settings.autoClose ?? DEFAULT_AUTO_CLOSE;
  const describedBy = [error !== undefined && `${id}-error`, note && `${id}-note`]
    .filter(Boolean)
    .join(" ");
  return (
    // The side being written has no outline: its label turns to ink, and its toolbar shows.
    <div className={cn("group flex flex-col gap-1 sm:flex-row sm:gap-6", className)}>
      <label
        id={`${id}-label`}
        onClick={() => inputRef.current?.focus()}
        className="pt-1 text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase transition-colors group-focus-within:text-foreground motion-reduce:transition-none sm:w-16 sm:shrink-0 sm:pt-2.5 sm:text-right"
      >
        {label}
      </label>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <LiveEditor
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          labelledBy={`${id}-label`}
          describedBy={describedBy === "" ? undefined : describedBy}
          invalid={error !== undefined}
          readOnly={readOnly}
          autoFocus={autoFocus}
          autoClose={autoClose}
          toolbarLabel={`${label} formatting`}
          viewRef={inputRef}
          onSubmit={onSubmit}
          onUpload={onUploading === undefined ? undefined : uploadImage}
          onUploading={onUploading}
          className={cn(
            // Ruled lines, one per line of text, so it writes like a page.
            "w-full rounded-md bg-[repeating-linear-gradient(to_bottom,transparent_0,transparent_calc(2rem-1px),var(--border)_calc(2rem-1px),var(--border)_2rem)] leading-[2rem]",
            error !== undefined && "outline-2 outline-offset-4 outline-destructive outline-solid",
            size,
          )}
        />
        {error !== undefined && (
          <p id={`${id}-error`} className="text-sm font-medium text-destructive">
            {error}
          </p>
        )}
        {note !== undefined && (
          // Always there, so what appears in it is announced.
          <div id={`${id}-note`} aria-live="polite">
            {note}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The writing page: the breadcrumb down to the Deck, the dateline over the
 * title, then the form, the Grading notes and the Tags field under the sides,
 * with `foot` along the card's foot and `after` below it. Ctrl/Cmd+Enter in
 * any field saves. Under the Front, a note warns
 * while it makes the Card a Duplicate of another live Card in the Deck; the
 * Card `selfId` names, the one being edited, never counts.
 *
 * Each side takes Images, pasted, dropped or picked with its toolbar's Image
 * button, and Save is held while an upload is on its way (`form.uploading`).
 * The Grading notes take none: their editor has no Image button, and ignores
 * files pasted or dropped on it.
 * A file dropped anywhere else on the page is never opened, so nothing written
 * is lost.
 */
export function CardEditor({
  deck,
  selfId,
  title,
  dateline,
  form,
  tags,
  onSave,
  saving = false,
  autoFocus = false,
  foot,
  after,
}: {
  deck: Deck;
  selfId?: string;
  title: string;
  dateline: ReactNode;
  form: CardForm;
  tags: TagInput;
  onSave: () => void;
  /** While a save is on its way, the sides can't be changed, so nothing typed meanwhile is lost. */
  saving?: boolean;
  autoFocus?: boolean;
  foot: ReactNode;
  after?: ReactNode;
}) {
  const library = useLibrary();
  const live = useSuspenseQuery(cardsQueryOptions(deck.id)).data;
  // A save refreshes the list before the form clears, so while it is on its
  // way the note keeps to the list as it stood: the Card being saved would
  // otherwise match itself for a moment.
  const [steady, setSteady] = useState(live);
  if (!saving && steady !== live) setSteady(live);
  const cards = saving ? steady : live;
  const duplicates = useMemo(
    () => duplicatesOf(form.fields.front, cards ?? [], selfId),
    [form.fields.front, cards, selfId],
  );
  const save = () => {
    if (!form.uploading) onSave();
  };
  const fieldProps = (field: keyof CardFields) => ({
    value: form.fields[field],
    error: form.errors[field],
    readOnly: saving,
    onChange: (value: string) => form.set(field, value),
    onSubmit: save,
  });
  const sideProps = (side: Side) => ({
    ...fieldProps(side),
    inputRef: side === "front" ? form.frontRef : form.backRef,
    onUploading: (uploading: boolean) => form.setUploading(side, uploading),
  });
  // Opened with the button, the notes take the focus it had.
  const [focusNotes, setFocusNotes] = useState(false);
  useEffect(keepDroppedFiles, []);
  return (
    <Page width="reading">
      <div className="flex flex-col gap-6 lg:gap-8">
        <Breadcrumb
          library={library}
          at={deck.folderId}
          deck={deck}
          last={title}
          onMove={ignoreMove}
        />
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-primary">{dateline}</p>
          <h1 className="text-[2.25rem] leading-[1.05] font-semibold tracking-[-0.035em] lg:text-5xl">
            {title}
          </h1>
        </div>
        <form
          noValidate
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            save();
          }}
          className="flex flex-col gap-7 rounded-2xl border bg-card px-4 py-6 shadow-xs sm:px-6 sm:py-7"
        >
          <Field
            label="Front"
            placeholder="What to be asked"
            note={duplicates.length > 0 ? <DuplicateNote duplicates={duplicates} /> : null}
            autoFocus={autoFocus}
            {...sideProps("front")}
          />
          <Field
            label="Back"
            placeholder="What to recall"
            // Room above it for the Front's note and its own toolbar.
            className="sm:mt-7 lg:mt-3"
            {...sideProps("back")}
          />
          {form.notesOpen ? (
            <Field
              label="Grading notes"
              placeholder="What an answer must include, or may vary in"
              inputRef={form.notesRef}
              autoFocus={focusNotes}
              // Room above it for its toolbar.
              className="sm:mt-7 lg:mt-3"
              {...fieldProps("gradingNotes")}
            />
          ) : (
            <div className="-my-2 sm:pl-22">
              <Button
                type="button"
                variant="ghost"
                disabled={saving}
                className={cn(PILL, "-ml-3 h-11 text-muted-foreground lg:h-10")}
                onClick={() => {
                  setFocusNotes(true);
                  form.openNotes();
                }}
              >
                <Plus aria-hidden />
                Add grading notes
              </Button>
            </div>
          )}
          <TagField input={tags} readOnly={saving} onSave={save} />
          <div className="flex flex-col gap-3 border-t pt-5 sm:flex-row sm:items-center sm:pl-22">
            {foot}
          </div>
        </form>
        {after}
      </div>
    </Page>
  );
}

/**
 * "Already in this deck: <the newest match's first line>", linking to its
 * edit page, with "and N more" for the other matches. A warning, not an
 * error: it never stops a save.
 */
function DuplicateNote({ duplicates }: { duplicates: readonly Card[] }) {
  const [newest] = duplicates;
  if (newest === undefined) return null;
  const more = duplicates.length - 1;
  return (
    <p className="flex items-start gap-2 rounded-md bg-muted px-3 text-sm text-foreground lg:py-2">
      <Copy aria-hidden className="mt-3.5 size-4 shrink-0 text-muted-foreground lg:mt-0.5" />
      <span className="min-w-0 break-words">
        Already in this deck:{" "}
        <Link
          to="/cards/$cardId"
          params={{ cardId: newest.id }}
          // At least 44 px tall below 1024 px, as every control is there.
          className="inline-flex max-w-full min-h-11 items-center font-medium lg:inline lg:min-h-0 hover:text-primary focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {/* A border, not an underline: an underline doesn't reach into an
              inline-block, which the name and each Formula in it are. */}
          <CardLine
            text={newest.front}
            className="inline-block max-w-full min-w-0 border-b border-current align-bottom leading-snug"
          />
        </Link>
        {more > 0 && ` and ${more} more`}
      </span>
    </p>
  );
}

/** Keeps the browser from opening files dragged where no side has taken them. */
function keep(event: DragEvent) {
  // A side that takes them has had them first.
  if (event.defaultPrevented || !(event.dataTransfer?.types.includes("Files") ?? false)) return;
  event.preventDefault();
  if (event.type === "dragover" && event.dataTransfer !== null) {
    event.dataTransfer.dropEffect = "none";
  }
}

/**
 * Keeps files dropped anywhere on the page but a side from being opened by
 * the browser, which would leave the page and lose what is written: for as
 * long as the writing page is up.
 */
function keepDroppedFiles() {
  window.addEventListener("dragover", keep);
  window.addEventListener("drop", keep);
  return () => {
    window.removeEventListener("dragover", keep);
    window.removeEventListener("drop", keep);
  };
}

/** Nothing is dragged on a Card's page, so nothing is ever dropped on its crumbs. */
const ignoreMove = () => {};

/** The hint at the foot of the form, from 1024 px. */
export function SaveHint() {
  return <p className="hidden text-sm text-muted-foreground lg:block">{SAVE_KEY}+Enter to save</p>;
}
