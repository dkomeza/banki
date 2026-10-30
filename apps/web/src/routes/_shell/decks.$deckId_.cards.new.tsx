import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { useRef, useState } from "react";
import { DeckMacros } from "@/components/cards/deck-macros";
import { FormError } from "@/components/auth-card";
import { CardEditor, SaveHint, useCardForm } from "@/components/cards/card-editor";
import { CardLine } from "@/components/cards/card-text";
import { DOT, RAIL, TIME_COL } from "@/components/cards/card-timeline";
import { useDiscardGuard } from "@/components/cards/discard-guard";
import { useTagInput } from "@/components/cards/tag-field";
import { DeckNotFound } from "@/components/not-found";
import { Page } from "@/components/page";
import { OUTLINE_PILL, PILL } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import { longDateLabel, timeLabel } from "@/lib/card-days";
import { type Card, cardsQueryOptions, createCard } from "@/lib/cards";
import { type Deck, deckQueryOptions } from "@/lib/decks";
import { ensureLibrary } from "@/lib/folders";
import { rememberedDeckSearch, tagsChanged, tagsQueryOptions } from "@/lib/tags";
import { cn } from "@/lib/utils";

// The new-card page: a dated writing page for one Card after another. Save
// creates the Card and stays, the sides cleared and the Front focused for the
// next one, with "Card added", and the Tags kept for it; the Cards written this visit gather under the
// form. Done goes back to the Deck. An unknown or deleted Deck shows "Deck
// not found".

export const Route = createFileRoute("/_shell/decks/$deckId_/cards/new")({
  loader: ({ context: { queryClient }, params: { deckId } }) => {
    // Only for suggestions: the page doesn't wait for them, or fail without them.
    void queryClient.prefetchQuery(tagsQueryOptions());
    return Promise.all([
      queryClient.ensureQueryData(deckQueryOptions(deckId)),
      queryClient.ensureQueryData(cardsQueryOptions(deckId)),
      ensureLibrary(queryClient),
    ]);
  },
  component: NewCardPage,
});

function NewCardPage() {
  const { deckId } = Route.useParams();
  const { data: deck } = useSuspenseQuery(deckQueryOptions(deckId));
  return deck === null ? (
    <Page width="reading">
      <DeckNotFound />
    </Page>
  ) : (
    <DeckMacros own={deck.macros}>
      <NewCard key={deck.id} deck={deck} />
    </DeckMacros>
  );
}

const BLANK = { front: "", back: "" };

function NewCard({ deck }: { deck: Deck }) {
  const queryClient = useQueryClient();
  const [added, setAdded] = useState(false);
  const form = useCardForm(BLANK, { onChange: () => setAdded(false) });
  const tags = useTagInput([]);
  // The Tags kept from the last Save don't count as unsaved.
  const [savedTags, setSavedTags] = useState<readonly string[]>([]);
  const guard = useDiscardGuard(
    form.unsaved || tagsChanged(tags.tags, savedTags) || tags.draft.trim() !== "",
  );
  const [written, setWritten] = useState<Card[]>([]);
  const [formError, setFormError] = useState<string>();
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (saving.current) return;
    const nextTags = tags.commit();
    if (nextTags === false) return;
    saving.current = true;
    setBusy(true);
    setFormError(undefined);
    const outcome = await createCard(queryClient, deck.id, form.fields, nextTags);
    saving.current = false;
    setBusy(false);
    if (outcome.ok) {
      setSavedTags(nextTags);
      setWritten((cards) => [outcome.card, ...cards]);
      form.markSaved(BLANK);
      setAdded(true);
      form.frontRef.current?.focus();
      return;
    }
    setAdded(false);
    if ("errors" in outcome) form.setErrors(outcome.errors);
    else if ("notFound" in outcome) setFormError("This deck was deleted meanwhile.");
    else setFormError(outcome.message);
  };

  return (
    <>
      <CardEditor
        deck={deck}
        title="New card"
        dateline={longDateLabel()}
        form={form}
        tags={tags}
        onSave={() => void save()}
        saving={busy}
        autoFocus
        foot={
          <>
            <div className="min-w-0 flex-1" aria-live="polite">
              {formError !== undefined ? (
                <FormError>{formError}</FormError>
              ) : added ? (
                <p role="status" className="flex items-center gap-2 text-[0.95rem] font-medium">
                  <Check aria-hidden className="size-4 text-primary" />
                  Card added. Write the next one.
                </p>
              ) : (
                <SaveHint />
              )}
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Link
                to="/decks/$deckId"
                params={{ deckId: deck.id }}
                search={rememberedDeckSearch(deck.id)}
                className={cn(
                  OUTLINE_PILL,
                  "inline-flex h-11 items-center justify-center border text-sm font-medium text-foreground no-underline hover:bg-muted lg:h-10",
                )}
              >
                Done
              </Link>
              <Button type="submit" className={cn(PILL, "h-11 lg:h-10")} disabled={form.uploading}>
                Save card
              </Button>
            </div>
          </>
        }
        after={written.length > 0 && <WrittenThisVisit cards={written} />}
      />
      {guard.dialog}
    </>
  );
}

/** The Cards written this visit, newest first, as a small timeline under the form. */
function WrittenThisVisit({ cards }: { cards: readonly Card[] }) {
  return (
    <section aria-labelledby="written-title" className="flex flex-col gap-4 border-t pt-6">
      <h2
        id="written-title"
        className="text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase"
      >
        Written this visit
      </h2>
      <ol className="flex flex-col">
        {cards.map((card, i) => (
          <li key={card.id} className="flex gap-3 sm:gap-4">
            <p
              className={cn(TIME_COL, "pt-3 text-right text-sm text-muted-foreground tabular-nums")}
            >
              {timeLabel(card.createdAt)}
            </p>
            <div className={cn(RAIL, "min-w-0 flex-1 pb-3")}>
              <span
                aria-hidden
                className={cn(DOT, "top-3.5", i === 0 ? "bg-primary" : "bg-input")}
              />
              <div className="rounded-xl border bg-card px-4 py-2.5 shadow-xs">
                <CardLine text={card.front} className="font-medium" />
                <CardLine text={card.back} className="text-sm text-muted-foreground" />
              </div>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
