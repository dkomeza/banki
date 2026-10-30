import { Pencil, RotateCcw, Trash2 } from "lucide-react";
import { FormError } from "@/components/auth-card";
import { CardEditor, SaveHint } from "@/components/cards/card-editor";
import { OUTLINE_PILL, PILL } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import type { Card } from "@/lib/cards";
import type { Deck } from "@/lib/decks";
import type { StudySession } from "@/lib/study";
import { cn } from "@/lib/utils";
import { type StudyEditor, useStudyEditor } from "./study-edit";

// Variant c, "In place": nothing opens. The Card turns into its own editor
// where it stands, Front and Back on the ruled lines in Focus's column, and
// the dock trades the ratings for the editor's foot: Reset progress on top of
// it, where the Intervals it changes were, then Delete, Cancel and Save. The
// top bar says "Editing" in place of the Deck's name. Edit is an outlined pill
// with its key, so it reads as a mode you step into.

export function EditButton({ disabled, onClick }: { disabled: boolean; onClick: () => void }) {
  return (
    <Button
      variant="outline"
      className="h-11 min-w-11 gap-1.5 rounded-full px-3 lg:h-8 lg:min-w-8"
      disabled={disabled}
      onClick={onClick}
      onMouseDown={(event) => event.preventDefault()}
      title="Edit card (E)"
      aria-label="Edit card"
    >
      <Pencil aria-hidden className="size-4" />
      <span className="hidden sm:inline">Edit</span>
      <kbd
        aria-hidden
        className="hidden rounded border px-1 font-sans text-[0.65rem] text-muted-foreground lg:inline"
      >
        E
      </kbd>
    </Button>
  );
}

/** Under a reset Card, in the dock, where "Back from Undo" goes. */
export function ResetNote() {
  return (
    <p className="text-center text-xs font-medium text-muted-foreground">
      <span className="font-semibold text-primary">New again.</span> Rate it as if you'd just met
      it.
    </p>
  );
}

/** Reset progress as one compact line: box, name, and a short why. */
export function ResetProgress({
  checked,
  onChange,
  className,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  className?: string;
}) {
  return (
    <label
      className={cn(
        "flex min-h-11 cursor-pointer flex-wrap items-center gap-x-3 gap-y-0.5 sm:pl-22 lg:min-h-9",
        className,
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="size-5 shrink-0 cursor-pointer accent-primary lg:size-4"
      />
      <span className="text-sm font-medium">Reset progress</span>
      <span className="basis-full pl-8 text-xs text-muted-foreground sm:basis-auto sm:pl-0 lg:pl-0">
        {checked ? "Saves it as a new card. Reviews stay." : "Its schedule stays as it is."}
      </span>
    </label>
  );
}

export function StudyEditorHost({
  deck,
  card,
  session,
  onClose,
}: {
  deck: Deck;
  card: Card;
  revealed: boolean;
  session: StudySession;
  onClose: (outcome: { edited?: Card; reset?: boolean; deleted?: boolean }) => void;
}) {
  const editor = useStudyEditor({ card, session, onClose });
  return (
    <section
      role="dialog"
      aria-modal="true"
      aria-label="Edit card"
      className="fixed inset-x-0 top-0 bottom-0 z-30 flex flex-col overflow-y-auto bg-background pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]"
    >
      <header className="sticky top-0 z-10 grid h-14 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-2 bg-background/95 px-2 backdrop-blur sm:px-4">
        <span />
        <span className="flex items-center gap-2 text-sm font-medium">
          <span aria-hidden className="size-2 rounded-full bg-primary" />
          Editing
          <span className="hidden max-w-[30vw] truncate text-muted-foreground sm:inline">
            · {deck.name}
          </span>
        </span>
        <span />
      </header>
      <div className="inplace-editor mx-auto flex w-full max-w-2xl flex-1 flex-col">
        <CardEditor
          bare
          deck={deck}
          selfId={card.id}
          title="Edit card"
          dateline=""
          form={editor.form}
          tags={editor.tags}
          saving={editor.saving}
          autoFocus={window.matchMedia("(pointer: fine)").matches}
          onSave={editor.save}
          className="flex-1 gap-8 rounded-none border-0 bg-transparent px-6 pt-6 pb-0 shadow-none sm:px-10 sm:pt-6 sm:pb-0 lg:pt-12"
          foot={<Foot editor={editor} />}
        />
      </div>
      {editor.dialog}
    </section>
  );
}

function Foot({ editor }: { editor: StudyEditor }) {
  return (
    <>
      {editor.studied && (
        <ResetProgress
          checked={editor.reset}
          onChange={editor.setReset}
          className="basis-full border-b pb-3 sm:pl-0"
        />
      )}
      <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
        <Button
          type="button"
          variant="ghost"
          className={cn(PILL, "-ml-3 h-11 text-destructive hover:text-destructive lg:h-10")}
          onClick={editor.remove}
        >
          <Trash2 aria-hidden />
          Delete
        </Button>
        {editor.formError !== undefined && <FormError>{editor.formError}</FormError>}
      </div>
      <SaveHint />
      <div className="grid grid-cols-2 gap-2 sm:flex">
        <Button
          type="button"
          variant="outline"
          className={cn(OUTLINE_PILL, "h-12 lg:h-10")}
          onClick={editor.cancel}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          className={cn(PILL, "h-12 lg:h-10")}
          disabled={editor.form.uploading || editor.saving}
        >
          {editor.reset && editor.studied ? (
            <>
              <RotateCcw aria-hidden />
              Save as new
            </>
          ) : (
            "Save"
          )}
        </Button>
      </div>
    </>
  );
}
