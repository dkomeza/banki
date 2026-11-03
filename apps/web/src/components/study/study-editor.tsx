import { useQueryClient } from "@tanstack/react-query";
import { Pencil, RotateCcw, Trash2, X } from "lucide-react";
import { type Ref, useEffect, useImperativeHandle, useRef, useState } from "react";
import { FormError } from "@/components/auth-card";
import { CardForm, SaveHint, useCardForm } from "@/components/cards/card-editor";
import { CardText } from "@/components/cards/card-text";
import { deleteWithUndo } from "@/components/cards/card-toasts";
import { DiscardDialog, useDiscardGuard } from "@/components/cards/discard-guard";
import { ResetProgress } from "@/components/cards/reset-progress";
import { useTagInput } from "@/components/cards/tag-field";
import { useFinePointer } from "@/components/folders/drag";
import { OUTLINE_PILL, PILL } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import { type Card, fieldsOf, resetOnSave, updateCard } from "@/lib/cards";
import type { Deck } from "@/lib/decks";
import { type StudySession, editorCloseAction } from "@/lib/study";
import { tagsChanged } from "@/lib/tags";
import { cn } from "@/lib/utils";

// Editing the shown Card over the study screen ("Morph"): Edit sits beside
// Undo in the top bar. From 1024 px the editor is a panel on the right, beside
// a live preview of the Card where Focus had it; below that, a sheet over the
// Card, up to the top bar. Its form is the edit page's, with Delete, Cancel and
// Save along its foot, and Reset progress above them on a studied Card. The
// Session, its counters and its Undo history stay as they are throughout.
// Opening and closing are View Transitions (morph.ts, index.css).

/** The top bar's Edit: a pill beside Undo, its label from 640 px. */
export function EditButton({ disabled, onClick }: { disabled: boolean; onClick: () => void }) {
  return (
    <Button
      variant="ghost"
      className="h-11 min-w-11 gap-1.5 rounded-full px-3 lg:h-9 lg:min-w-9"
      disabled={disabled}
      onClick={onClick}
      // A click leaves no focus behind, so Space still reveals.
      onMouseDown={(event) => event.preventDefault()}
      title="Edit card (E)"
      aria-label="Edit card"
    >
      <Pencil aria-hidden className="size-4" />
      <span className="hidden sm:inline">Edit</span>
    </Button>
  );
}

/** In the dock, over a Card just put back to New: a quiet accent chip. */
export function ResetNote() {
  return (
    <p className="mx-auto flex w-fit items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary [view-transition-name:reset-note]">
      <RotateCcw aria-hidden className="size-3.5" />
      Back to New: these are a new card's intervals
    </p>
  );
}

/** What the study screen asks of the open editor: closing it as Cancel would, from ×. */
export type StudyEditorHandle = { cancel: () => void };

/**
 * The open editor over the shown Card `card`, revealed or not (`revealed`).
 * Save writes the Card (with a Progress reset when ticked on a studied one)
 * and shows it again; Cancel, × and Esc close it, through the discard guard
 * when something is unsaved; Delete deletes the Card at once, with Undo, and
 * the next one loads. A failed save keeps it open with its error, and a Card
 * deleted elsewhere says so there, the next one loading once it is closed.
 */
export function StudyEditor({
  deck,
  card,
  revealed,
  session,
  ref,
}: {
  deck: Deck;
  card: Card;
  revealed: boolean;
  session: StudySession;
  ref?: Ref<StudyEditorHandle>;
}) {
  const queryClient = useQueryClient();
  const fine = useFinePointer();
  const form = useCardForm(fieldsOf(card));
  const tags = useTagInput(card.tags);
  // Unticked every time the editor opens.
  const [reset, setReset] = useState(false);
  const [formError, setFormError] = useState<string>();
  const [saving, setSaving] = useState(false);
  // The Card was deleted elsewhere: nothing is left to save, or to ask about.
  const [gone, setGone] = useState(false);
  const [asking, setAsking] = useState(false);
  // A ticked Reset progress is unsaved too.
  const unsaved =
    !gone &&
    (form.unsaved ||
      tagsChanged(tags.tags, card.tags) ||
      tags.draft.trim() !== "" ||
      resetOnSave(card, reset));
  // Leaving the study screen with something unsaved asks too.
  const guard = useDiscardGuard(unsaved);
  const busy = useRef(false);

  const cancel = () => {
    if (busy.current) return;
    const action = editorCloseAction({ gone, unsaved });
    if (action === "skip") void session.closeGone();
    else if (action === "ask") setAsking(true);
    else session.cancelEdit();
  };
  useImperativeHandle(ref, () => ({ cancel }));

  const save = async () => {
    // Ctrl/⌘+Enter too: with the Card gone, there is nothing to save.
    if (busy.current || gone) return;
    const nextTags = tags.commit();
    if (nextTags === false) return;
    busy.current = true;
    setSaving(true);
    setFormError(undefined);
    const resetProgress = resetOnSave(card, reset);
    const outcome = await updateCard(queryClient, card.id, form.fields, nextTags, {
      resetProgress,
    });
    if (outcome.ok) {
      guard.release();
      await session.saveEdit(outcome.card, { progressReset: resetProgress });
      return;
    }
    busy.current = false;
    setSaving(false);
    if ("errors" in outcome) form.setErrors(outcome.errors);
    else if ("notFound" in outcome) {
      setGone(true);
      setFormError("This card, or its deck, was deleted meanwhile.");
    } else setFormError(outcome.message);
  };

  // Deletes first, so a delete that fails leaves the editor, and what's typed, as it was.
  const remove = async () => {
    if (busy.current) return;
    busy.current = true;
    const deleted = await deleteWithUndo(queryClient, card, async () => {
      guard.release();
      void session.closeGone();
    });
    if (!deleted) busy.current = false;
  };

  // Esc closes, through the discard guard; the editor's own Esc (a popup) comes
  // first, and so does a "Discard changes?" dialog's, ours or the route's.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || asking) return;
      if (document.querySelector('[role="alertdialog"]') !== null) return;
      event.preventDefault();
      cancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  return (
    <div className="fixed inset-x-0 top-[calc(3.5rem+env(safe-area-inset-top))] bottom-0 z-30 flex">
      {/* The Card as it will read, from 1024 px, where Focus had it. */}
      <div className="hidden min-w-0 flex-1 flex-col overflow-y-auto bg-background lg:flex">
        <div className="relative mx-auto flex w-full max-w-2xl flex-col px-10 pt-12 pb-10">
          <p className="absolute top-5 left-10 text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
            Preview
          </p>
          <CardText
            text={form.fields.front}
            className={cn(
              "font-medium tracking-[-0.015em] [view-transition-name:card-front]",
              revealed
                ? "text-2xl leading-snug text-muted-foreground"
                : "text-[2.6rem] leading-tight",
            )}
          />
          <div aria-hidden className="my-8 h-px w-16 bg-border [view-transition-name:card-rule]" />
          <CardText
            text={form.fields.back}
            className="text-xl leading-relaxed [view-transition-name:card-back]"
          />
        </div>
      </div>
      {/* Not modal: the top bar stays in reach, its × closing the editor. */}
      <section
        role="dialog"
        aria-label="Edit card"
        data-study-editor
        className="flex w-full flex-col overflow-y-auto rounded-t-[1.5rem] border-t bg-card shadow-[0_-18px_40px_-20px_rgb(48_28_10/0.35)] [view-transition-name:edit-panel] lg:w-[34rem] lg:shrink-0 lg:rounded-none lg:border-t-0 lg:border-l lg:shadow-[-24px_0_48px_-32px_rgb(48_28_10/0.35)]"
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
            onClick={cancel}
          >
            <X aria-hidden className="size-5" />
          </Button>
        </header>
        {/* Room below the foot for the toolbar a phone docks over it while a field has the focus. */}
        <div className="flex-1 pb-[calc(6rem+env(safe-area-inset-bottom))] lg:pb-0">
          <CardForm
            stacked
            deck={deck}
            selfId={card.id}
            form={form}
            tags={tags}
            saving={saving}
            autoFocus={fine}
            onSave={() => void save()}
            className="rounded-none border-0 bg-transparent px-4 shadow-none sm:px-6"
            beforeFoot={
              card.studied ? (
                <ResetProgress stacked checked={reset} onChange={setReset} disabled={saving} />
              ) : undefined
            }
            foot={
              <>
                <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    className={cn(
                      PILL,
                      "-ml-3 h-11 text-destructive hover:text-destructive lg:h-10",
                    )}
                    disabled={saving || gone}
                    onClick={() => void remove()}
                  >
                    <Trash2 aria-hidden />
                    Delete
                  </Button>
                  {formError !== undefined && <FormError>{formError}</FormError>}
                </div>
                <div className="hidden xl:block">
                  <SaveHint />
                </div>
                <div className="flex flex-col-reverse gap-2 sm:flex-row">
                  <Button
                    type="button"
                    variant="outline"
                    className={cn(OUTLINE_PILL, "h-11 lg:h-10")}
                    disabled={saving}
                    onClick={cancel}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    className={cn(PILL, "h-11 lg:h-10")}
                    disabled={form.uploading || saving || gone}
                  >
                    Save
                  </Button>
                </div>
              </>
            }
          />
        </div>
      </section>
      <DiscardDialog
        open={asking}
        onKeep={() => setAsking(false)}
        onDiscard={() => {
          setAsking(false);
          session.cancelEdit();
        }}
      />
      {guard.dialog}
    </div>
  );
}
