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
import { type Card, editUnsaved, fieldsOf, updateCard } from "@/lib/cards";
import type { Deck } from "@/lib/decks";
import {
  type StudySession,
  type StudyState,
  editorCloseAction,
  editorEscAction,
  saveStudyEdit,
} from "@/lib/study";
import { cn } from "@/lib/utils";

// Editing the shown Card over the study screen ("Morph"): Edit sits beside
// Undo in the top bar. From 1024 px the editor is a panel on the right, beside
// a live preview of the Card where Focus had it; below that, a sheet over the
// Card, up to the top bar. Its form is the edit page's, with Delete, Cancel and
// Save along its foot, and Reset progress above them on a studied Card. The
// Session and its counters stay as they are throughout, and so does its Undo
// history, but that a Progress reset saved here settles the Card's earlier
// Ratings, which can't be undone after it (ADR-0026).
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

/** In the dock, over a Card just put back to New: a quiet accent chip, popping in as it first shows (`turning`). */
export function ResetNote({ turning = false }: { turning?: boolean }) {
  return (
    <p
      className={cn(
        "mx-auto flex w-fit items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary",
        turning && "[view-transition-name:reset-note]",
      )}
    >
      <RotateCcw aria-hidden className="size-3.5" />
      Back to New: these are a New card's intervals
    </p>
  );
}

/** Keys that, pressed alone, leave an armed Esc as it is (as CodeMirror does). */
const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta"]);

/** What the study screen asks of the open editor: closing it as Cancel would, from ×. */
export type StudyEditorHandle = { cancel: () => void };

/**
 * The top bar's ×: while editing, it closes the editor (`editor`) as Cancel
 * does, through the discard guard, and stays ("stay"); otherwise it leaves
 * the study screen as the Session says (`StudySession.leave`).
 */
export function leaveOrCancelEdit(
  session: { getState: () => Pick<StudyState, "editing">; leave: StudySession["leave"] },
  editor: StudyEditorHandle | null,
): "summary" | "away" | "stay" {
  if (!session.getState().editing) return session.leave();
  editor?.cancel();
  return "stay";
}

/**
 * The open editor over the shown Card `card`, revealed or not (`revealed`).
 * Save writes the Card (with a Progress reset when ticked on a studied one)
 * and shows it again; Cancel, × and Esc close it, through the discard guard
 * when something is unsaved (in Front or Back, the first Esc only leaves the
 * field); Delete deletes the Card at once, with Undo, and
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
  const [deleting, setDeleting] = useState(false);
  // While a Save or a Delete is on its way, the rest waits for it.
  const pending = saving || deleting;
  // The Card was deleted elsewhere: nothing is left to save, or to ask about.
  const [gone, setGone] = useState(false);
  const [asking, setAsking] = useState(false);
  // A ticked Reset progress is unsaved too.
  const unsaved =
    !gone &&
    editUnsaved(card, {
      fieldsUnsaved: form.unsaved,
      tags: tags.tags,
      draft: tags.draft,
      ticked: reset,
    });
  // Leaving the study screen with something unsaved asks too.
  const guard = useDiscardGuard(unsaved, pending);
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
    const outcome = await saveStudyEdit(
      session,
      card,
      reset,
      (options) => updateCard(queryClient, card.id, form.fields, nextTags, options),
      guard.release,
    );
    if (outcome.ok) return;
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
    setDeleting(true);
    const deleted = await deleteWithUndo(queryClient, card, async () => {
      guard.release();
      void session.closeGone();
    });
    if (deleted) return;
    busy.current = false;
    setDeleting(false);
  };

  // Esc closes, through the discard guard; the editor's own Esc (a popup) comes
  // first, and so does a "Discard changes?" dialog's, ours or the route's. In
  // Front or Back the first Esc is CodeMirror's, so Tab then leaves the field,
  // and only a second one closes (editorEscAction).
  const escArmed = useRef<Element | null>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        if (!MODIFIER_KEYS.has(event.key)) escArmed.current = null;
        return;
      }
      // A held Esc is one press: its repeats neither close nor ask. An Esc that
      // cancels an IME conversion is the input method's.
      if (event.repeat || event.isComposing || event.keyCode === 229) return;
      if (event.defaultPrevented || asking) {
        escArmed.current = null;
        return;
      }
      if (document.querySelector('[role="alertdialog"]') !== null) return;
      const field =
        event.target instanceof Element
          ? event.target.closest("[data-study-editor] .cm-editor")
          : null;
      if (editorEscAction(field, escArmed.current) === "leave-field") {
        escArmed.current = field;
        return;
      }
      escArmed.current = null;
      event.preventDefault();
      cancel();
    };
    // A click moves the focus, or the caret, so the next Esc leaves the field again.
    const onPointer = () => {
      escArmed.current = null;
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  });

  return (
    <div className="fixed inset-x-0 top-[calc(3.5rem+env(safe-area-inset-top))] bottom-0 z-30 flex">
      {/* The Card as it will read, from 1024 px, where Focus had it. */}
      <div className="hidden min-w-0 flex-1 flex-col overflow-y-auto bg-background pl-[env(safe-area-inset-left)] lg:flex">
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
        className="flex w-full flex-col overflow-y-auto overscroll-contain rounded-t-[1.5rem] border-t bg-card pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)] lg:pl-0 shadow-[0_-18px_40px_-20px_rgb(48_28_10/0.35)] [view-transition-name:edit-panel] lg:w-[34rem] lg:shrink-0 lg:rounded-none lg:border-t-0 lg:border-l lg:shadow-[-24px_0_48px_-32px_rgb(48_28_10/0.35)]"
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
        <div className="flex-1 pb-[calc(6rem+env(safe-area-inset-bottom))] lg:pb-[env(safe-area-inset-bottom)]">
          <CardForm
            stacked
            deck={deck}
            selfId={card.id}
            form={form}
            tags={tags}
            saving={pending}
            autoFocus={fine}
            linkDuplicate={false}
            onSave={() => void save()}
            className="rounded-none border-0 bg-transparent px-4 shadow-none sm:px-6"
            beforeFoot={
              <ResetProgress
                stacked
                card={card}
                checked={reset}
                onChange={setReset}
                disabled={pending || gone}
              />
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
                    disabled={pending || gone}
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
                    disabled={pending}
                    onClick={cancel}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    className={cn(PILL, "h-11 lg:h-10")}
                    disabled={form.uploading || pending || gone}
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
