import { Pencil, RotateCcw, Trash2, X } from "lucide-react";
import { useRef, useState } from "react";
import { FormError } from "@/components/auth-card";
import { CardEditor, SaveHint } from "@/components/cards/card-editor";
import { CardText } from "@/components/cards/card-text";
import { OUTLINE_PILL, PILL } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import type { Card } from "@/lib/cards";
import type { Deck } from "@/lib/decks";
import type { StudySession } from "@/lib/study";
import { cn } from "@/lib/utils";
import { type StudyEditor, useStudyEditor } from "./study-edit";

// Variant d, "Glide": Margin (b) with Sheet's (a) Edit pill beside Undo, and
// in motion. From 1024 px the Card slides aside to become the preview as the
// panel slides in from the right, and slides back to the middle as it leaves;
// the dock sinks away while editing. Below 1024 px the sheet rises from the
// bottom and sinks back. The Reset progress row, the reset chip and a reset
// Card's Intervals animate as they change. Without motion, all of it is
// instant.

type Outcome = { edited?: Card; reset?: boolean; deleted?: boolean };

/** How long the editor takes to leave, as in `index.css`'s `glide-*-out`. */
const LEAVE_MS = 260;

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function EditButton({ disabled, onClick }: { disabled: boolean; onClick: () => void }) {
  return (
    <Button
      variant="ghost"
      className="group h-11 min-w-11 gap-1.5 rounded-full px-3 lg:h-9 lg:min-w-9"
      disabled={disabled}
      onClick={onClick}
      onMouseDown={(event) => event.preventDefault()}
      title="Edit card (E)"
      aria-label="Edit card"
    >
      <Pencil
        aria-hidden
        className="size-4 transition-transform duration-200 group-hover:-rotate-12 motion-reduce:transition-none"
      />
      <span className="hidden sm:inline">Edit</span>
    </Button>
  );
}

/** Under a reset Card, in the dock: a quiet accent chip that pops in. */
export function ResetNote() {
  return (
    <p className="mx-auto flex w-fit items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-90 motion-safe:duration-300">
      <RotateCcw
        aria-hidden
        className="size-3.5 motion-safe:animate-[glide-spin-back_600ms_ease-out]"
      />
      Back to New: these are a new card's intervals
    </p>
  );
}

/** The Reset progress row: a bordered box that takes the accent when ticked. */
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
    <div className={cn("sm:pl-22", className)}>
      <label
        className={cn(
          "flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 transition-colors duration-300 motion-reduce:transition-none",
          checked ? "border-primary/60 bg-primary/8" : "bg-muted/50 hover:bg-muted",
        )}
      >
        <RotateCcw
          aria-hidden
          className={cn(
            "size-4 shrink-0 transition-[transform,color] duration-500 ease-out motion-reduce:transition-none",
            checked ? "-rotate-360 text-primary" : "text-muted-foreground",
          )}
        />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-sm font-medium">Reset progress</span>
          <span
            key={String(checked)}
            className="text-[0.8rem] leading-snug text-muted-foreground motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-1 motion-safe:duration-300"
          >
            {checked
              ? "On save, this card goes back to New and you rate it again from the start."
              : "Keeps its reviews, starts its schedule over."}
          </span>
        </span>
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          className="size-5 shrink-0 cursor-pointer accent-primary"
        />
      </label>
    </div>
  );
}

export function StudyEditorHost({
  deck,
  card,
  revealed,
  session,
  onClose,
}: {
  deck: Deck;
  card: Card;
  revealed: boolean;
  session: StudySession;
  onClose: (outcome: Outcome) => void;
}) {
  // Leaving plays the way out, then closes: the Card under it is the same one.
  const [leaving, setLeaving] = useState(false);
  const left = useRef(false);
  const leave = (outcome: Outcome) => {
    if (left.current) return;
    left.current = true;
    if (reducedMotion()) {
      onClose(outcome);
      return;
    }
    setLeaving(true);
    setTimeout(() => onClose(outcome), LEAVE_MS);
  };
  const editor = useStudyEditor({ card, session, onClose: leave });
  return (
    <div
      data-leaving={leaving || undefined}
      className="glide fixed inset-x-0 top-[calc(3.5rem+env(safe-area-inset-top))] bottom-0 z-30 flex"
    >
      {/* The Card as it will read, from 1024 px: Focus's Card, slid aside. */}
      <div className="hidden min-w-0 flex-1 flex-col overflow-y-auto lg:flex">
        <div className="glide-preview relative mx-auto flex w-full max-w-2xl flex-col px-10 pt-12 pb-10">
          <p className="glide-label absolute top-5 left-10 text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
            Preview
          </p>
          <CardText
            text={editor.form.fields.front}
            className={cn(
              "font-medium tracking-[-0.015em]",
              revealed
                ? "text-2xl leading-snug text-muted-foreground"
                : "text-[2.6rem] leading-tight",
            )}
          />
          <div aria-hidden className="my-8 h-px w-16 bg-border" />
          <CardText text={editor.form.fields.back} className="text-xl leading-relaxed" />
        </div>
      </div>
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Edit card"
        className="glide-panel flex w-full flex-col overflow-y-auto rounded-t-[1.5rem] border-t bg-card shadow-[0_-18px_40px_-20px_rgb(48_28_10/0.35)] lg:w-[34rem] lg:shrink-0 lg:rounded-none lg:border-t-0 lg:border-l lg:shadow-[-24px_0_48px_-32px_rgb(48_28_10/0.35)]"
      >
        <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b bg-card/95 px-4 py-2 backdrop-blur sm:px-6">
          <div
            aria-hidden
            className="absolute top-1.5 left-1/2 h-1 w-10 -translate-x-1/2 rounded-full bg-border lg:hidden"
          />
          <h2 className="text-base font-semibold tracking-tight">Edit card</h2>
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
        <div className="glide-body stacked-editor flex-1 pb-[env(safe-area-inset-bottom)]">
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
            className="rounded-none border-0 bg-transparent px-4 shadow-none sm:px-6"
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
      <div className="hidden xl:block">
        <SaveHint />
      </div>
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
          Save
        </Button>
      </div>
    </>
  );
}
