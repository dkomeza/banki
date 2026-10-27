import {
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useId,
  useRef,
  useState,
} from "react";
import { Breadcrumb } from "@/components/folders/breadcrumb";
import { useLibrary } from "@/components/folders/use-library";
import { Page } from "@/components/page";
import { type SideErrors, type Sides, hasUnsavedChanges } from "@/lib/cards";
import type { Deck } from "@/lib/decks";
import { cn } from "@/lib/utils";

// New card and Edit card are one writing page: a dated page with the two
// sides written on ruled lines inside a bordered card, their labels in the
// margin from 640 px, and the actions along the card's foot under a hairline.

/** The form's state: the sides as typed, what counts as saved, and each side's error. */
export function useCardForm(saved0: Sides) {
  const [fields, setFields] = useState(saved0);
  const [saved, setSaved] = useState(saved0);
  const [errors, setErrors] = useState<SideErrors>({});
  const frontRef = useRef<HTMLTextAreaElement>(null);
  return {
    fields,
    errors,
    frontRef,
    unsaved: hasUnsavedChanges(fields, saved),
    /** Changes one side, clearing that side's error. */
    set: (side: keyof Sides, value: string) => {
      setFields((current) => ({ ...current, [side]: value }));
      setErrors((current) => ({ ...current, [side]: undefined }));
    },
    setErrors,
    /** Marks `next` as saved and shows it, so leaving doesn't ask. */
    markSaved: (next: Sides) => {
      setSaved(next);
      setFields(next);
      setErrors({});
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
  inputRef,
  autoFocus,
  readOnly,
  onChange,
  onKeyDown,
}: {
  label: "Front" | "Back";
  readOnly: boolean;
  placeholder: string;
  value: string;
  error: string | undefined;
  inputRef?: RefObject<HTMLTextAreaElement | null>;
  autoFocus?: boolean;
  onChange: (value: string) => void;
  onKeyDown: (event: KeyboardEvent) => void;
}) {
  const id = useId();
  const front = label === "Front";
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:gap-6">
      <label
        htmlFor={id}
        className="pt-1 text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase sm:w-16 sm:shrink-0 sm:pt-2.5 sm:text-right"
      >
        {label}
      </label>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <textarea
          id={id}
          ref={inputRef}
          rows={front ? 2 : 5}
          value={value}
          autoFocus={autoFocus}
          readOnly={readOnly}
          spellCheck
          aria-invalid={error === undefined ? undefined : true}
          aria-describedby={error === undefined ? undefined : `${id}-error`}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          // Ruled lines, one per line of text, so it writes like a page.
          style={{
            backgroundImage:
              "repeating-linear-gradient(to bottom, transparent 0, transparent calc(2rem - 1px), var(--border) calc(2rem - 1px), var(--border) 2rem)",
            backgroundAttachment: "local",
          }}
          className={cn(
            "field-sizing-content w-full resize-none rounded-md bg-transparent px-1 py-0 leading-[2rem] outline-none placeholder:text-muted-foreground/70 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring focus-visible:outline-solid aria-invalid:outline-2 aria-invalid:outline-offset-4 aria-invalid:outline-destructive aria-invalid:outline-solid",
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
      </div>
    </div>
  );
}

/**
 * The writing page: the breadcrumb down to the Deck, the dateline over the
 * title, then the form, with `foot` along the card's foot and `after` below
 * it. Ctrl/Cmd+Enter in either side saves.
 */
export function CardEditor({
  deck,
  title,
  dateline,
  form,
  onSave,
  saving = false,
  autoFocus = false,
  foot,
  after,
  tags,
}: {
  deck: Deck;
  title: string;
  dateline: ReactNode;
  form: CardForm;
  onSave: () => void;
  /** While a save is on its way, the sides can't be changed, so nothing typed meanwhile is lost. */
  saving?: boolean;
  autoFocus?: boolean;
  foot: ReactNode;
  after?: ReactNode;
  /** Prototype (BAN-14): the Tags field, under Front and Back. */
  tags?: ReactNode;
}) {
  const library = useLibrary();
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      onSave();
    }
  };
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
            onSave();
          }}
          className="flex flex-col gap-7 rounded-2xl border bg-card px-4 py-6 shadow-xs sm:px-6 sm:py-7"
        >
          <Side
            label="Front"
            placeholder="What to be asked"
            value={form.fields.front}
            error={form.errors.front}
            inputRef={form.frontRef}
            autoFocus={autoFocus}
            readOnly={saving}
            onChange={(value) => form.set("front", value)}
            onKeyDown={onKeyDown}
          />
          <Side
            label="Back"
            placeholder="What to recall"
            value={form.fields.back}
            error={form.errors.back}
            readOnly={saving}
            onChange={(value) => form.set("back", value)}
            onKeyDown={onKeyDown}
          />
          {tags}
          <div className="flex flex-col gap-3 border-t pt-5 sm:flex-row sm:items-center sm:pl-22">
            {foot}
          </div>
        </form>
        {after}
      </div>
    </Page>
  );
}

/** Nothing is dragged on a Card's page, so nothing is ever dropped on its crumbs. */
const ignoreMove = () => {};

/** The hint at the foot of the form, from 1024 px. */
export function SaveHint() {
  return <p className="hidden text-sm text-muted-foreground lg:block">{SAVE_KEY}+Enter to save</p>;
}
