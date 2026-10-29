import { DEFAULT_AUTO_CLOSE } from "@banki/shared";
import { startCompletion } from "@codemirror/autocomplete";
import { EditorView } from "@codemirror/view";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Copy } from "lucide-react";
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
import {
  type Card,
  type SideErrors,
  type Sides,
  cardsQueryOptions,
  duplicatesOf,
  hasUnsavedChanges,
} from "@/lib/cards";
import type { Deck } from "@/lib/decks";
import { uploadImage } from "@/lib/images";
import { PROTO_QUERIES, protoSides, protoState } from "@/lib/proto-state";
import { settingsQueryOptions } from "@/lib/settings";
import { insertCommand } from "@/components/editor/latex-complete";
import { COMMANDS } from "@/components/editor/latex-commands";
import { cn } from "@/lib/utils";

// New card and Edit card are one writing page: a dated page with the two
// sides written on ruled lines inside a bordered card, their labels in the
// margin from 640 px, the Tags field under them, and the actions along the
// card's foot under a hairline. Images go into a side through its editor.

/**
 * The form's state: the sides as typed, what counts as saved, each side's
 * error, and whether an Image is on its way up into either side. `onChange`
 * hears of every change to a side, typed or an Image put in.
 */
export function useCardForm(given: Sides, { onChange }: { onChange?: () => void } = {}) {
  const saved0 = protoSides(given);
  const [fields, setFields] = useState(saved0);
  const [saved, setSaved] = useState(saved0);
  const [errors, setErrors] = useState<SideErrors>({});
  const [uploading, setUploading] = useState({ front: false, back: false });
  const frontRef = useRef<EditorView>(null);
  const backRef = useRef<EditorView>(null);
  const latest = useRef(saved0);
  const set = (side: keyof Sides, value: string) => {
    latest.current = { ...latest.current, [side]: value };
    setFields(latest.current);
    setErrors((current) => ({ ...current, [side]: undefined }));
    onChange?.();
  };
  return {
    fields,
    errors,
    frontRef,
    backRef,
    unsaved: hasUnsavedChanges(fields, saved),
    /** Changes one side, clearing that side's error. */
    set,
    setErrors,
    /**
     * Marks `next` as saved and shows it, so leaving doesn't ask, and takes
     * away the error tiles of uploads that failed.
     */
    markSaved: (next: Sides) => {
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
    setUploading: (side: keyof Sides, now: boolean) =>
      setUploading((current) => ({ ...current, [side]: now })),
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
  inputRef,
  autoFocus,
  readOnly,
  onChange,
  onSubmit,
  onUploading,
  className,
  protoCheatsheet,
}: {
  protoCheatsheet?: string;
  label: "Front" | "Back";
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
  /** Hears whether an Image is on its way up into it. */
  onUploading: (uploading: boolean) => void;
  className?: string;
}) {
  const id = useId();
  const front = label === "Front";
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
          onUpload={uploadImage}
          onUploading={onUploading}
          protoCheatsheet={protoCheatsheet}
          className={cn(
            // Ruled lines, one per line of text, so it writes like a page.
            "w-full rounded-md bg-[repeating-linear-gradient(to_bottom,transparent_0,transparent_calc(2rem-1px),var(--border)_calc(2rem-1px),var(--border)_2rem)] leading-[2rem]",
            error !== undefined && "outline-2 outline-offset-4 outline-destructive outline-solid",
            front
              ? "min-h-16 text-xl/[2rem] font-semibold tracking-tight"
              : "min-h-32 text-[1.05rem]/[2rem]",
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
 * title, then the form, the Tags field under the sides, with `foot` along the
 * card's foot and `after` below it. Ctrl/Cmd+Enter in either side, or in the
 * Tags, saves. Under the Front, a note warns
 * while it makes the Card a Duplicate of another live Card in the Deck; the
 * Card `selfId` names, the one being edited, never counts.
 *
 * Each side takes Images, pasted, dropped or picked with its toolbar's Image
 * button, and Save is held while an upload is on its way (`form.uploading`).
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
  const sideProps = (side: keyof Sides) => ({
    value: form.fields[side],
    error: form.errors[side],
    readOnly: saving,
    inputRef: side === "front" ? form.frontRef : form.backRef,
    onChange: (value: string) => form.set(side, value),
    onSubmit: save,
    onUploading: (uploading: boolean) => form.setUploading(side, uploading),
  });
  useEffect(keepDroppedFiles, []);
  useProtoState(form);
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
            autoFocus={autoFocus}
            protoCheatsheet={protoState === null ? undefined : PROTO_QUERIES[protoState]}
            {...sideProps("front")}
          />
          <Side
            label="Back"
            placeholder="What to recall"
            // Room above it for the Front's note and its own toolbar.
            className="sm:mt-7 lg:mt-3"
            {...sideProps("back")}
          />
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

/** Prototype only: puts the editor in the `?state=` the page was opened with. */
function useProtoState(form: CardForm) {
  useEffect(() => {
    const front = form.frontRef.current;
    const back = form.backRef.current;
    if (front === null || back === null || protoState === null) return undefined;
    const afterFr = (view: EditorView) => view.state.doc.toString().indexOf("\\fr$") + 3;
    if (protoState === "completing-cell") {
      // Focusing the side redraws its grid, so the cell is found again after.
      const find = () => {
        for (const el of back.dom.querySelectorAll(".cm-lp-cell .cm-editor")) {
          const cell = el instanceof HTMLElement ? EditorView.findFromDOM(el) : null;
          if (cell !== null && cell.state.doc.toString().includes("\\fr$")) return cell;
        }
        return null;
      };
      find()?.focus();
      const later = setTimeout(() => {
        const cell = find();
        if (cell === null) return;
        cell.focus();
        cell.dispatch({ selection: { anchor: afterFr(cell) } });
        startCompletion(cell);
      }, 150);
      return () => clearTimeout(later);
    }
    const timer = setTimeout(() => {
      switch (protoState) {
        case "completing": {
          front.focus();
          front.dispatch({ selection: { anchor: afterFr(front) } });
          startCompletion(front);
          break;
        }
        case "slots": {
          front.focus();
          const at = afterFr(front);
          const frac = COMMANDS.find((command) => command.name === "\\frac");
          if (frac !== undefined) insertCommand(front, frac, at - 3, at);
          break;
        }
        default:
          if (protoState !== null && protoState in PROTO_QUERIES) {
            front.dispatch({ selection: { anchor: front.state.doc.line(1).to } });
          }
      }
    }, 200);
    return () => clearTimeout(timer);
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/** Nothing is dragged on a Card's page, so nothing is ever dropped on its crumbs. */
const ignoreMove = () => {};

/** The hint at the foot of the form, from 1024 px. */
export function SaveHint() {
  return <p className="hidden text-sm text-muted-foreground lg:block">{SAVE_KEY}+Enter to save</p>;
}
