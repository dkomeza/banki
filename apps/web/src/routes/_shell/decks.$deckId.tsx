import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { CornerDownRight, Pencil, Settings2, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { DeckMacros } from "@/components/cards/deck-macros";
import { deleteAllWithUndo, showMovedToast } from "@/components/cards/card-toasts";
import { CardTimeline } from "@/components/cards/card-timeline";
import { DeckPicker } from "@/components/cards/deck-picker";
import { ConfirmDelete } from "@/components/decks/confirm-delete";
import { Cover, Stack } from "@/components/decks/cover";
import { DeckDialog } from "@/components/decks/deck-dialog";
import { StudyCard } from "@/components/decks/study-card";
import { showDeletedToast } from "@/components/deleted/toasts";
import { DeckNotFound } from "@/components/not-found";
import { Breadcrumb } from "@/components/folders/breadcrumb";
import { placeRoute, usePlaceActions } from "@/components/folders/place-actions";
import { useLibrary } from "@/components/folders/use-library";
import { Page } from "@/components/page";
import { OUTLINE_PILL } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import { type Card, cardCountLabel, cardsQueryOptions, moveCards } from "@/lib/cards";
import {
  type Deck,
  createdLabel,
  deckQueryOptions,
  deleteDeck,
  forgetDeck,
  updateDeck,
} from "@/lib/decks";
import { ensureLibrary, placePath } from "@/lib/folders";
import { deckRetentionLabel } from "@/lib/retention";
import { useSelection } from "@/lib/selection";
import { settingsQueryOptions } from "@/lib/settings";
import { studyOverviewQueryOptions } from "@/lib/study-overview";
import { deckSearch, rememberDeckSearch } from "@/lib/tags";
import { cn } from "@/lib/utils";

// The deck page opens with the breadcrumb from "Decks" down to the Deck, then
// the Deck's stack, its cover on top, beside the name and the whole
// description, a line saying when it was created, how many Cards it has and
// the Desired retention it schedules with (a link to its settings page), the
// Study card (what Study will bring, StudyCard), and Edit, Settings, Move… and
// Delete under them. Edit opens the same dialog as
// create; Delete asks in a dialog, naming how many Cards go with it. The Cards follow below, on a timeline (CardTimeline), searched and
// filtered by Tag through the URL (`?q=…&tags=verb,irregular`), so Back from a
// Card's edit page comes back to the same list. Cards Move to another Deck
// one at a time from a Card's ⋯ menu, or several at once from selection mode,
// through the destination picker (DeckPicker); selected Cards can be deleted
// together too.

/** A dialog or menu that is open, which Esc closes before it leaves selection mode. */
const OPEN_LAYER = '[role="dialog"], [role="alertdialog"], [role="menu"]';

export const Route = createFileRoute("/_shell/decks/$deckId")({
  validateSearch: deckSearch,
  loader: ({ context: { queryClient }, params: { deckId } }) =>
    Promise.all([
      queryClient.ensureQueryData(deckQueryOptions(deckId)),
      queryClient.ensureQueryData(cardsQueryOptions(deckId)),
      queryClient.ensureQueryData(settingsQueryOptions()),
      ensureLibrary(queryClient),
      // Never thrown: without it, the Study card is just the Study pill.
      queryClient.prefetchQuery(studyOverviewQueryOptions(deckId)),
    ]),
  component: DeckPage,
});

function DeckPage() {
  const { deckId } = Route.useParams();
  const { data: deck } = useSuspenseQuery(deckQueryOptions(deckId));

  return (
    <Page width="cards">
      <div className="flex flex-col gap-6 lg:gap-8">
        {deck === null ? (
          <DeckNotFound />
        ) : (
          <DeckMacros own={deck.macros}>
            <DeckBody key={deck.id} deck={deck} />
          </DeckMacros>
        )}
      </div>
    </Page>
  );
}

function DeckBody({ deck }: { deck: Deck }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const library = useLibrary();
  const actions = usePlaceActions(library);
  // Null only when the Deck was deleted meanwhile, as its page is about to say.
  const cards = useSuspenseQuery(cardsQueryOptions(deck.id)).data ?? [];
  const filter = Route.useSearch();
  const { desiredRetention } = useSuspenseQuery(settingsQueryOptions()).data.settings;
  useEffect(() => {
    rememberDeckSearch(deck.id, filter);
  }, [deck.id, filter]);
  const selection = useSelection();
  // The Cards the destination picker is open for, while it is.
  const [moving, setMoving] = useState<readonly Card[]>();
  const [moveBusy, setMoveBusy] = useState(false);
  const [moveError, setMoveError] = useState<string>();
  const pick = (chosen: readonly Card[]) => {
    setMoveError(undefined);
    setMoving(chosen);
  };
  const move = async (to: Deck) => {
    if (moving === undefined) return;
    const ids = moving.map((card) => card.id);
    setMoveBusy(true);
    const outcome = await moveCards(queryClient, ids, deck.id, to.id);
    setMoveBusy(false);
    if (!outcome.ok) {
      setMoveError(
        "notFound" in outcome
          ? "A card or that deck was deleted meanwhile, so nothing moved."
          : outcome.message,
      );
      return;
    }
    setMoving(undefined);
    selection.exit();
    showMovedToast(queryClient, ids, deck, to);
  };
  // Esc leaves selection mode, unless a dialog or menu is open, such as the
  // picker or Edit: Esc closes that first, and the selection stays.
  const { active: selecting, exit } = selection;
  useEffect(() => {
    if (!selecting || moving !== undefined) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (document.querySelector(OPEN_LAYER) !== null) return;
      exit();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selecting, exit, moving]);

  return (
    <>
      <Breadcrumb library={library} at={deck.folderId} last={deck.name} onMove={actions.drop} />
      <header className="flex flex-col gap-6 sm:flex-row sm:items-start sm:gap-8 lg:gap-10">
        <Stack className="aspect-[4/3] w-36 shrink-0 sm:w-48 lg:w-56">
          <Cover
            name={deck.name}
            className="w-full rounded-2xl border text-5xl sm:text-6xl lg:text-7xl"
          />
        </Stack>
        <div className="flex min-w-0 flex-col gap-4">
          <h1 className="text-[2.25rem] leading-[1.05] font-semibold tracking-[-0.035em] [overflow-wrap:anywhere] lg:text-5xl">
            {deck.name}
          </h1>
          {deck.description !== null ? (
            <p className="max-w-prose text-[1.05rem] leading-relaxed whitespace-pre-line text-muted-foreground [overflow-wrap:anywhere]">
              {deck.description}
            </p>
          ) : (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="min-h-11 w-fit text-left text-[1.05rem] text-muted-foreground italic underline-offset-4 lg:min-h-0 hover:text-foreground hover:underline"
            >
              Add a description
            </button>
          )}
          <p className="text-sm text-muted-foreground tabular-nums">
            Created {createdLabel(deck.createdAt)} · {cardCountLabel(cards.length).toLowerCase()} ·{" "}
            <Link
              to="/decks/$deckId/settings"
              params={{ deckId: deck.id }}
              className="text-muted-foreground no-underline underline-offset-4 hover:text-foreground hover:underline"
            >
              {deckRetentionLabel(deck.desiredRetention, desiredRetention)}
            </Link>
          </p>
          <StudyCard deckId={deck.id} />
          <div className="flex shrink-0 flex-wrap gap-2 pt-1">
            <Button
              variant="outline"
              className={cn(OUTLINE_PILL, "h-11")}
              onClick={() => setEditing(true)}
            >
              <Pencil aria-hidden />
              Edit
            </Button>
            <Button
              variant="outline"
              className={cn(OUTLINE_PILL, "h-11 text-foreground no-underline")}
              render={<Link to="/decks/$deckId/settings" params={{ deckId: deck.id }} />}
              nativeButton={false}
            >
              <Settings2 aria-hidden />
              Settings
            </Button>
            <Button
              variant="outline"
              className={cn(OUTLINE_PILL, "h-11")}
              onClick={() => actions.move({ kind: "deck", id: deck.id })}
            >
              <CornerDownRight aria-hidden />
              Move…
            </Button>
            <Button
              variant="outline"
              className={cn(OUTLINE_PILL, "h-11 text-destructive hover:text-destructive")}
              onClick={() => setDeleting(true)}
            >
              <Trash2 aria-hidden />
              Delete
            </Button>
          </div>
        </div>
      </header>

      <CardTimeline
        deckId={deck.id}
        cards={cards}
        filter={filter}
        onFilter={(search) => void navigate({ to: ".", search, replace: true })}
        selection={selection}
        onMove={pick}
        onDelete={(chosen) => {
          // Selection mode ends once they are deleted; a failed delete keeps the selection.
          void deleteAllWithUndo(queryClient, deck.id, chosen).then((deleted) => {
            if (deleted) selection.exit();
          });
        }}
      />

      <DeckDialog
        open={editing}
        onOpenChange={setEditing}
        title="Edit deck"
        submitLabel="Save"
        submittingLabel="Saving…"
        initial={{ name: deck.name, description: deck.description ?? "" }}
        onSubmit={async (form) => {
          const outcome = await updateDeck(queryClient, deck.id, form);
          if (outcome.ok) setEditing(false);
          return outcome;
        }}
      />
      <ConfirmDelete
        open={deleting}
        onOpenChange={setDeleting}
        name={deck.name}
        description={
          <>
            <span className="font-medium text-foreground [overflow-wrap:anywhere]">
              “{deck.name}”
            </span>
            {cards.length === 0
              ? " will be deleted."
              : ` and its ${cardCountLabel(cards.length).toLowerCase()} will be deleted.`}
          </>
        }
        onConfirm={async () => {
          const outcome = await deleteDeck(queryClient, deck.id);
          if (!outcome.ok) return outcome.message;
          await navigate(placeRoute(deck.folderId));
          forgetDeck(queryClient, deck.id);
          showDeletedToast(queryClient, {
            name: deck.name,
            deletionId: outcome.deletionId,
            where: placePath(library.folders, deck.folderId),
          });
          return undefined;
        }}
      />
      <DeckPicker
        library={library}
        from={deck}
        cards={moving}
        busy={moveBusy}
        error={moveError}
        onMove={(to) => void move(to)}
        onClose={() => setMoving(undefined)}
      />
      {actions.dialogs}
    </>
  );
}
