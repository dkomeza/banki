import type { EditorView } from "@codemirror/view";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Copy } from "lucide-react";
import {
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { LiveEditor } from "@/components/editor/live-editor";
import { protoSides } from "@/components/editor/proto-state";
import {
  AddImageButton,
  ImageStrip,
  UploadFailures,
  useImageUploads,
} from "@/components/cards/card-images";
import { Breadcrumb } from "@/components/folders/breadcrumb";
import { useLibrary } from "@/components/folders/use-library";
import { Page } from "@/components/page";
import { TagField, type TagInput } from "@/components/cards/tag-field";
import { CardLine } from "@/components/cards/card-text";
import {
  type Card,
  type SideErrors,
  type Sides,
  cardsQueryOptions,
  duplicatesOf,
  hasUnsavedChanges,
} from "@/lib/cards";
import type { Deck } from "@/lib/decks";
import { insertOnOwnLine, withoutReference } from "@/lib/images";
import { cn } from "@/lib/utils";

// New card and Edit card are one writing page: a dated page with the two
// sides written on ruled lines inside a bordered card, their labels in the
// margin from 640 px, the Tags field under them, and the actions along the
// card's foot under a hairline, "Add image" first.

/**
 * The form's state: the sides as typed, what counts as saved, each side's
 * error, and the Images on their way up. `onChange` hears of every change to
 * a side, typed or an Image put in.
 *
 * Each Image uploaded goes on a line of its own at the cursor of the side
 * focused last, the Back when neither has been yet. The sides as last written
 * are kept apart from what has rendered, so uploads that finish together each
 * go after the one before.
 */
export function useCardForm(given: Sides, { onChange }: { onChange?: () => void } = {}) {
  // Variant-only: a `?state=` link starts the form with its sample sides.
  const [proto] = useState(protoSides);
  const saved0 = proto?.sides ?? given;
  const [fields, setFields] = useState(saved0);
  const [saved, setSaved] = useState(saved0);
  const [errors, setErrors] = useState<SideErrors>({});
  const frontRef = useRef<EditorView>(null);
  const backRef = useRef<EditorView>(null);
  const latest = useRef(saved0);
  const focused = useRef<keyof Sides>(undefined);
  const cursors = useRef<Partial<Record<keyof Sides, number>>>({});
  const set = (side: keyof Sides, value: string) => {
    latest.current = { ...latest.current, [side]: value };
    setFields(latest.current);
    setErrors((current) => ({ ...current, [side]: undefined }));
    onChange?.();
  };
  const uploads = useImageUploads((markdown) => {
    const side = focused.current ?? "back";
    const text = latest.current[side];
    const placed = insertOnOwnLine(text, cursors.current[side] ?? text.length, markdown);
    cursors.current[side] = placed.cursor;
    set(side, placed.text);
  });
  return {
    fields,
    errors,
    frontRef,
    backRef,
    /** Variant-only: the side a `?state=` link focuses, and where its cursor goes. */
    proto: proto && { side: proto.side, cursor: proto.cursor },
    unsaved: hasUnsavedChanges(fields, saved),
    /** Changes one side, clearing that side's error. */
    set,
    setErrors,
    /** Marks `next` as saved and shows it, so leaving doesn't ask. */
    markSaved: (next: Sides) => {
      latest.current = next;
      cursors.current = {};
      setSaved(next);
      setFields(next);
      setErrors({});
    },
    /** Whether an Image is on its way up, which holds Save. */
    uploading: uploads.uploading,
    /** The uploads that failed or were refused, of the files picked last. */
    uploadFailures: uploads.failures,
    /** Uploads the files picked, putting each one's reference in as it is done. */
    addImages: (files: readonly File[]) => void uploads.pick(files),
    /** Notes that `side` has the focus now. */
    focus: (side: keyof Sides) => {
      focused.current = side;
    },
    /** Notes where the cursor is in `side` now, as the User moves it or types. */
    moveCursor: (side: keyof Sides, cursor: number) => {
      cursors.current[side] = cursor;
    },
  };
}

export type CardForm = ReturnType<typeof useCardForm>;

/** Ctrl+Enter, or Cmd+Enter on a Mac, the shortcut that saves. */
const SAVE_KEY =
  typeof navigator !== "undefined" && /Mac|iP/.test(navigator.platform) ? "⌘" : "Ctrl";

/** One side on ruled lines, its label in the margin from 640 px. */
function Side({
  label,
  placeholder,
  value,
  error,
  note,
  images,
  inputRef,
  autoFocus,
  initialCursor,
  readOnly,
  toolbar,
  onChange,
  onSubmit,
  onFocus,
  onSelect,
}: {
  label: "Front" | "Back";
  readOnly: boolean;
  placeholder: string;
  value: string;
  error: string | undefined;
  /** A note under the field, announced politely: the Duplicate warning. */
  note?: ReactNode;
  /** The thumbnails of the Images it refers to, under the field. */
  images: ReactNode;
  inputRef: RefObject<EditorView | null>;
  autoFocus?: boolean;
  initialCursor?: number;
  /** The side's formatting toolbar, where the Variant puts it. */
  toolbar?: ReactNode;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onFocus: () => void;
  /** Where the cursor is now, as the User moves it or types. */
  onSelect: (cursor: number) => void;
}) {
  const id = useId();
  const front = label === "Front";
  const describedBy = [error !== undefined && `${id}-error`, note && `${id}-note`]
    .filter(Boolean)
    .join(" ");
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:gap-6">
      <label
        id={`${id}-label`}
        onClick={() => inputRef.current?.focus()}
        className="pt-1 text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase sm:w-16 sm:shrink-0 sm:pt-2.5 sm:text-right"
      >
        {label}
      </label>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div
          data-side={label.toLowerCase()}
          data-invalid={error === undefined ? undefined : true}
          // Ruled lines, one per line of text, so it writes like a page.
          style={{
            backgroundImage:
              "repeating-linear-gradient(to bottom, transparent 0, transparent calc(2rem - 1px), var(--border) calc(2rem - 1px), var(--border) 2rem)",
          }}
          className={cn(
            "side-field relative w-full rounded-md leading-[2rem] has-[>.live-editor>.cm-focused]:outline-2 has-[>.live-editor>.cm-focused]:outline-offset-4 has-[>.live-editor>.cm-focused]:outline-ring has-[>.live-editor>.cm-focused]:outline-solid data-invalid:outline-2 data-invalid:outline-offset-4 data-invalid:outline-destructive data-invalid:outline-solid",
            front
              ? "min-h-16 text-xl/[2rem] font-semibold tracking-tight"
              : "min-h-32 text-[1.05rem]/[2rem]",
          )}
        >
          <LiveEditor
            value={value}
            viewRef={inputRef}
            labelledBy={`${id}-label`}
            describedBy={describedBy === "" ? undefined : describedBy}
            invalid={error !== undefined}
            readOnly={readOnly}
            autoFocus={autoFocus}
            initialCursor={initialCursor}
            placeholder={placeholder}
            onChange={onChange}
            onSubmit={onSubmit}
            onFocus={onFocus}
            onCursor={onSelect}
            className={front ? "min-h-16" : "min-h-32"}
          />
        </div>
        {toolbar}
        {images}
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
 * title, then the form, the Tags field under the sides, with `foot` along the
 * card's foot and `after` below it. Ctrl/Cmd+Enter in either side, or in the
 * Tags, saves. Under the Front, a note warns
 * while it makes the Card a Duplicate of another live Card in the Deck; the
 * Card `selfId` names, the one being edited, never counts.
 *
 * "Add image" puts each Image it uploads on a line of its own at the cursor
 * of the side focused last, the Back when neither has been yet, and Save is
 * held while an upload is on its way (`form.uploading`).
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
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      save();
    }
  };
  const sideProps = (side: keyof Sides) => ({
    value: form.fields[side],
    error: form.errors[side],
    readOnly: saving,
    images: (
      <ImageStrip
        markdown={form.fields[side]}
        readOnly={saving}
        onRemove={(ref) => form.set(side, withoutReference(form.fields[side], ref))}
      />
    ),
    inputRef: side === "front" ? form.frontRef : form.backRef,
    autoFocus: form.proto ? form.proto.side === side : side === "front" && autoFocus,
    initialCursor: form.proto?.side === side ? form.proto.cursor : undefined,
    onChange: (value: string) => form.set(side, value),
    onSubmit: save,
    onFocus: () => form.focus(side),
    onSelect: (cursor: number) => form.moveCursor(side, cursor),
  });
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
          <Side
            label="Front"
            placeholder="What to be asked"
            note={duplicates.length > 0 ? <DuplicateNote duplicates={duplicates} /> : null}
            {...sideProps("front")}
          />
          <Side label="Back" placeholder="What to recall" {...sideProps("back")} />
          <TagField input={tags} readOnly={saving} onSave={save} />
          <div className="flex flex-col gap-3 border-t pt-5 sm:flex-row sm:items-center sm:pl-22">
            <AddImageButton uploading={form.uploading} disabled={saving} onPick={form.addImages} />
            {foot}
          </div>
        </form>
        <UploadFailures failures={form.uploadFailures} />
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

/** Nothing is dragged on a Card's page, so nothing is ever dropped on its crumbs. */
const ignoreMove = () => {};

/** The hint at the foot of the form, from 1024 px. */
export function SaveHint() {
  return <p className="hidden text-sm text-muted-foreground lg:block">{SAVE_KEY}+Enter to save</p>;
}
