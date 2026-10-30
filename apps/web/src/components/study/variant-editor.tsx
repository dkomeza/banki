import { Pencil, RotateCcw, Trash2, X } from "lucide-react";
import { useEffect } from "react";
import { FormError } from "@/components/auth-card";
import { CardEditor, SaveHint } from "@/components/cards/card-editor";
import { OUTLINE_PILL, PILL } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import type { Card } from "@/lib/cards";
import type { Deck } from "@/lib/decks";
import type { StudySession } from "@/lib/study";
import { cn } from "@/lib/utils";
import { type StudyEditor, useStudyEditor } from "./study-edit";

// Variant a, "Sheet": the editor is a sheet of paper laid over Focus. On a
// phone it takes the whole screen, rising from the dock; from 640 px it is
// the edit page's card, centred over the dimmed Card, with the study screen
// still there around it. Edit sits beside Undo, as a peer of it. Reset
// progress is a plain checkbox line above the foot's hairline, saying what it
// keeps.

export function EditButton({ disabled, onClick }: { disabled: boolean; onClick: () => void }) {
  return (
    <Button
      variant="ghost"
      className="h-11 min-w-11 gap-1.5 rounded-full px-3 lg:h-9 lg:min-w-9"
      disabled={disabled}
      onClick={onClick}
      onMouseDown={(event) => event.preventDefault()}
      title="Edit card (E)"
      aria-label="Edit card"
    >
      <Pencil aria-hidden className="size-4" />
      <span className="hidden sm:inline">Edit</span>
    </Button>
  );
}

/** Under a reset Card, in the dock, where "Back from Undo" goes. */
export function ResetNote() {
  return (
    <p className="flex items-center justify-center gap-1.5 text-center text-xs font-medium text-muted-foreground">
      <RotateCcw aria-hidden className="size-3.5" />
      Progress reset: rate it as a new card
    </p>
  );
}

/** The Reset progress checkbox: a box, its name, and what it does underneath. */
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
        "flex min-h-11 cursor-pointer items-start gap-3 sm:pl-22 lg:min-h-0",
        className,
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 size-5 shrink-0 cursor-pointer accent-primary lg:size-4"
      />
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">Reset progress</span>
        <span className="text-sm text-muted-foreground">
          Start this card over as new. Its past reviews are kept.
        </span>
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
  // The page under the sheet stays put.
  useEffect(() => {
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
    };
  }, []);
  return (
    <div className="fixed inset-0 z-30 flex flex-col">
      {/* oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- Esc and Cancel close by keyboard. */}
      <div
        aria-hidden
        onClick={editor.cancel}
        className="absolute inset-0 hidden bg-foreground/25 backdrop-blur-[2px] sm:block dark:bg-black/55"
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Edit card"
        className="relative flex h-full flex-col overflow-y-auto bg-background pt-[env(safe-area-inset-top)] motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-6 sm:m-auto sm:h-auto sm:max-h-[calc(100svh-3rem)] sm:w-[min(46rem,calc(100vw-3rem))] sm:rounded-[1.5rem] sm:border sm:bg-card sm:pt-0 sm:shadow-2xl"
      >
        <header className="flex items-baseline justify-between gap-3 px-5 pt-5 pb-1 sm:px-8 sm:pt-7">
          <div className="flex min-w-0 flex-col gap-1">
            <p className="truncate text-sm font-medium text-primary">{deck.name}</p>
            <h2 className="text-[1.75rem] leading-tight font-semibold tracking-[-0.03em]">
              Edit card
            </h2>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-11 rounded-full lg:size-9"
            aria-label="Cancel"
            title="Cancel (Esc)"
            onClick={editor.cancel}
          >
            <X aria-hidden className="size-5" />
          </Button>
        </header>
        <div className="flex-1 pb-[env(safe-area-inset-bottom)]">
          <CardEditor
            bare
            deck={deck}
            selfId={card.id}
            title="Edit card"
            dateline=""
            form={editor.form}
            tags={editor.tags}
            saving={editor.saving}
            // Not on touch: the keyboard would cover the sheet before it is read.
            autoFocus={window.matchMedia("(pointer: fine)").matches}
            onSave={editor.save}
            className="rounded-none border-0 bg-transparent shadow-none sm:px-8"
            beforeFoot={
              editor.studied ? (
                <ResetProgress checked={editor.reset} onChange={editor.setReset} />
              ) : undefined
            }
            foot={<Foot editor={editor} />}
          />
        </div>
      </section>
      {editor.dialog}
    </div>
  );
}

function Foot({ editor }: { editor: StudyEditor }) {
  return (
    <>
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
      <div className="flex flex-col-reverse gap-2 sm:flex-row">
        <Button
          type="button"
          variant="outline"
          className={cn(OUTLINE_PILL, "h-11 lg:h-10")}
          onClick={editor.cancel}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          className={cn(PILL, "h-11 lg:h-10")}
          disabled={editor.form.uploading || editor.saving}
        >
          {editor.reset && editor.studied ? "Save and reset" : "Save"}
        </Button>
      </div>
    </>
  );
}
