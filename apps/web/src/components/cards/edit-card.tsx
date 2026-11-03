import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { FormError } from "@/components/auth-card";
import { CardEditor, useCardForm } from "@/components/cards/card-editor";
import { deleteWithUndo } from "@/components/cards/card-toasts";
import { useDiscardGuard } from "@/components/cards/discard-guard";
import { ResetProgress } from "@/components/cards/reset-progress";
import { useTagInput } from "@/components/cards/tag-field";
import { OUTLINE_PILL, PILL } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import { dayLabel, timeLabel } from "@/lib/card-days";
import {
  type Card,
  type CardOutcome,
  editUnsaved,
  fieldsOf,
  saveCardEdit,
  updateCard,
} from "@/lib/cards";
import type { Deck } from "@/lib/decks";
import { rememberedDeckSearch } from "@/lib/tags";
import { cn } from "@/lib/utils";

/** "Written today, 13:00", "Written Tue 20 Oct, 09:05". */
const writtenLabel = (createdAt: string) => {
  const day = dayLabel(createdAt);
  return `Written ${day === "Today" || day === "Yesterday" ? day.toLowerCase() : day}, ${timeLabel(createdAt)}`;
};

/**
 * The edit page's form for the Card `card` in its Deck `deck` (`/cards/$cardId`):
 * Save, with a Progress reset when Reset progress is ticked on a studied Card,
 * Cancel and Delete, each going back to the Deck, through the discard guard
 * when something is unsaved.
 */
export function EditCard({ deck, card }: { deck: Deck; card: Card }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const form = useCardForm(fieldsOf(card));
  const tags = useTagInput(card.tags);
  const [reset, setReset] = useState(false);
  // A Save or a Delete on its way: the other waits for it.
  const pending = useRef(false);
  // The Card as a Save on its way found it. Meanwhile Reset progress can't
  // change, and its row stays as it was, though the Save's answer (a Card back
  // to New) is cached before the page is left. A Save that went through keeps
  // it until the page is gone.
  const [savingFrom, setSavingFrom] = useState<Card>();
  const [deleting, setDeleting] = useState(false);
  // Save, Cancel, Delete, the breadcrumbs and Back all wait for a Save or a
  // Delete on its way, so nothing leaves or writes while its answer can still
  // land.
  const busy = savingFrom !== undefined || deleting;
  // A ticked Reset progress is unsaved too.
  const guard = useDiscardGuard(
    editUnsaved(card, {
      fieldsUnsaved: form.unsaved,
      tags: tags.tags,
      draft: tags.draft,
      ticked: reset,
    }),
    busy,
  );
  const [formError, setFormError] = useState<string>();
  // A refetch that finds the Card New takes the row away, and its tick with it,
  // so it never comes back ticked.
  if (reset && !card.studied && savingFrom === undefined) setReset(false);
  const toDeck = () =>
    navigate({
      to: "/decks/$deckId",
      params: { deckId: deck.id },
      search: rememberedDeckSearch(deck.id),
    });

  const save = async () => {
    if (pending.current) return;
    const nextTags = tags.commit();
    if (nextTags === false) return;
    pending.current = true;
    setSavingFrom(card);
    setFormError(undefined);
    let outcome: CardOutcome | undefined;
    try {
      outcome = await saveCardEdit(
        card,
        reset,
        (options) => updateCard(queryClient, card.id, form.fields, nextTags, options),
        async () => {
          guard.release();
          await toDeck();
        },
      );
    } finally {
      // Unless it went through, Save and Reset progress work again.
      if (!outcome?.ok) {
        pending.current = false;
        setSavingFrom(undefined);
      }
    }
    if (outcome.ok) return;
    if ("errors" in outcome) form.setErrors(outcome.errors);
    else if ("notFound" in outcome) setFormError("This card, or its deck, was deleted meanwhile.");
    else setFormError(outcome.message);
  };

  // A Delete that fails leaves the page, and what's typed, as it was.
  const remove = async () => {
    if (pending.current) return;
    pending.current = true;
    setDeleting(true);
    const deleted = await deleteWithUndo(queryClient, card, async () => {
      guard.release();
      await toDeck();
    });
    if (deleted) return;
    pending.current = false;
    setDeleting(false);
  };

  return (
    <>
      <CardEditor
        deck={deck}
        selfId={card.id}
        title="Edit card"
        dateline={writtenLabel(card.createdAt)}
        form={form}
        tags={tags}
        saving={busy}
        onSave={() => void save()}
        beforeFoot={
          <ResetProgress
            card={savingFrom ?? card}
            checked={reset}
            onChange={setReset}
            disabled={busy}
          />
        }
        foot={
          <>
            <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
              <Button
                type="button"
                variant="ghost"
                className={cn(PILL, "-ml-3 h-11 text-destructive hover:text-destructive lg:h-10")}
                disabled={busy}
                onClick={() => void remove()}
              >
                <Trash2 aria-hidden />
                Delete
              </Button>
              {formError !== undefined && <FormError>{formError}</FormError>}
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button
                type="button"
                variant="outline"
                className={cn(OUTLINE_PILL, "h-11 lg:h-10")}
                disabled={busy}
                onClick={() => void toDeck()}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                className={cn(PILL, "h-11 lg:h-10")}
                disabled={form.uploading || busy}
              >
                Save
              </Button>
            </div>
          </>
        }
      />
      {guard.dialog}
    </>
  );
}
