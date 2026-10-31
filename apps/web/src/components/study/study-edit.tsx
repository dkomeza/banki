import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { deleteWithUndo } from "@/components/cards/card-toasts";
import { useCardForm } from "@/components/cards/card-editor";
import { DiscardDialog } from "@/components/cards/discard-guard";
import { useTagInput } from "@/components/cards/tag-field";
import { type Card, updateCard } from "@/lib/cards";
import type { StudySession } from "@/lib/study";
import { tagsChanged } from "@/lib/tags";

// Prototype (BAN-27): editing the shown Card over the study screen. What every
// Variant shares: the form, Save / Cancel / Delete, the Reset progress tick,
// Esc through the discard guard, and the `?state=` names that open each state.
// The API has no `resetProgress` or `studied` yet, so a Save with the tick
// sends the edit alone, and every Card counts as studied but on `editing-new`
// (the Seed data has no Reviews).

/** The `?state=` the page was opened with, if any. */
export function protoState(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("state");
}

/**
 * Variant e: runs `update` as a View Transition, so what it changes moves
 * between the two screens; at once without motion or the API. The new frame
 * waits, a second at most, for `settled`: the editor mounts a beat late the
 * first time it opens.
 */
export function morph(update: () => void, settled: () => boolean = () => true) {
  if (
    typeof document.startViewTransition !== "function" ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    update();
    return;
  }
  document.startViewTransition(async () => {
    flushSync(update);
    const until = performance.now() + 1000;
    while (!settled() && performance.now() < until) {
      await new Promise((resolve) => setTimeout(resolve, 16));
    }
  });
}

/** Whether the Card counts as studied, so the Reset progress tick shows. */
export const studiedInProto = () => protoState() !== "editing-new";

/**
 * The open editor's form and actions for `card`. `onClose` shows the Card
 * again: as edited, with `reset` when Progress was reset, or unchanged.
 */
export function useStudyEditor({
  card,
  session,
  onClose,
}: {
  card: Card;
  session: StudySession;
  onClose: (outcome: { edited?: Card; reset?: boolean; deleted?: boolean }) => void;
}) {
  const queryClient = useQueryClient();
  const state = protoState();
  const form = useCardForm({
    front: card.front,
    back: card.back,
  });
  const tags = useTagInput(card.tags);
  const studied = studiedInProto();
  const [reset, setReset] = useState(state === "reset");
  const [formError, setFormError] = useState<string>();
  const [asking, setAsking] = useState(false);
  const [saving, setSaving] = useState(false);
  const unsaved = form.unsaved || tagsChanged(tags.tags, card.tags) || tags.draft.trim() !== "";

  // `?state=discard`: something typed, then Esc.
  const once = useRef(false);
  useEffect(() => {
    if (once.current || state !== "discard") return;
    once.current = true;
    form.set("back", `${card.back}\n\nOjo: casi siempre en plural.`);
    setAsking(true);
  }, [state, card.back, form]);

  const cancel = () => {
    if (unsaved) setAsking(true);
    else onClose({});
  };

  const save = async () => {
    if (saving) return;
    const nextTags = tags.commit();
    if (nextTags === false) return;
    setSaving(true);
    setFormError(undefined);
    const outcome = await updateCard(queryClient, card.id, form.fields, nextTags);
    setSaving(false);
    if (outcome.ok) {
      onClose({ edited: outcome.card, reset: studied && reset });
      return;
    }
    if ("errors" in outcome) form.setErrors(outcome.errors);
    else if ("notFound" in outcome) setFormError("This card, or its deck, was deleted meanwhile.");
    else setFormError(outcome.message);
  };

  const remove = () =>
    deleteWithUndo(queryClient, card, async () => {
      onClose({ deleted: true });
      session.skip();
    });

  // Esc closes, through the discard guard; the editor's own Esc (a popup) comes first.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || asking) return;
      event.preventDefault();
      cancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  return {
    form,
    tags,
    studied,
    reset,
    setReset,
    saving,
    formError,
    save: () => void save(),
    cancel,
    remove: () => void remove(),
    dialog: (
      <DiscardDialog
        open={asking}
        onKeep={() => setAsking(false)}
        onDiscard={() => {
          setAsking(false);
          onClose({});
        }}
      />
    ),
  };
}

export type StudyEditor = ReturnType<typeof useStudyEditor>;

/**
 * The study screen's editing state: whether the editor is open, the Card's
 * time paused while it is, the `?state=` that opens it on load, and whether
 * the shown Card was just reset.
 */
export function useStudyEditing(session: StudySession, phase: string, cardId: string | undefined) {
  const [open, setOpen] = useState(false);
  // The Card just reset, if it is still the one shown.
  const [resetCard, setResetCard] = useState<string>();
  const justReset = resetCard !== undefined && resetCard === cardId;
  const resume = useRef<(() => void) | undefined>(undefined);
  const openEditor = () => {
    if (open) return;
    resume.current = session.pause();
    morph(
      () => setOpen(true),
      () => document.querySelector("[role=dialog] .cm-content") !== null,
    );
  };
  const close = ({ edited, reset }: { edited?: Card; reset?: boolean; deleted?: boolean }) => {
    resume.current?.();
    resume.current = undefined;
    morph(() => {
      setOpen(false);
      if (edited !== undefined) {
        session.replace(edited, reset ? session.getState().shown?.intervals : undefined);
        setResetCard(reset === true ? edited.id : undefined);
      }
    });
  };

  // The `?state=` names, once the first Card shows. In development the
  // Session starts twice (Strict Mode), so a Card that shows again in the
  // first moments gets the state again.
  const applied = useRef(false);
  useEffect(() => {
    if (applied.current || phase !== "card") return;
    applied.current = true;
    const state = protoState();
    if (
      state === null ||
      !["editing", "editing-front", "editing-new", "reset", "edited", "discard"].includes(state)
    )
      return;
    const apply = () => {
      const shown = session.getState().shown;
      if (shown === undefined) return;
      if (state !== "editing-front") session.reveal();
      if (state === "edited") setResetCard(shown.card.id);
    };
    apply();
    if (state !== "edited") openEditor();
    let last = session.getState().shown;
    const stop = session.subscribe(() => {
      const shown = session.getState().shown;
      if (shown !== undefined && shown.card.id !== last?.card.id) apply();
      else if (shown !== undefined && last !== shown && !session.getState().revealed) apply();
      last = shown;
    });
    setTimeout(stop, 2000);
  });

  return { open, openEditor, close, justReset };
}
