import { useSuspenseQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Breadcrumb } from "@/components/folders/breadcrumb";
import { usePlaceActions } from "@/components/folders/place-actions";
import { useLibrary } from "@/components/folders/use-library";
import { DeckNotFound } from "@/components/not-found";
import { Page } from "@/components/page";
import { AnswerModeCard } from "@/components/settings/answer-mode-card";
import { DeckRetentionCard } from "@/components/settings/deck-retention-card";
import { DeckMacrosCard } from "@/components/settings/macros-card";
import { PlanCard } from "@/components/settings/plan-card";
import { type Section, SectionIndex } from "@/components/settings/section-index";
import { type Deck, deckQueryOptions } from "@/lib/decks";
import { ensureLibrary } from "@/lib/folders";
import { settingsQueryOptions } from "@/lib/settings";
import { tuningQueryOptions } from "@/lib/tuning";
import { useHiddenScrollbar } from "@/lib/use-hidden-scrollbar";

// A Deck's settings, on a page of their own built like Settings: the setting
// the page is about first, full width, then its Math macros, Answer mode and
// Plan. Desired retention is one picker whose first
// choice is Follow Settings, the Recommended retention, and a picture of ten
// cards coming due.

export const Route = createFileRoute("/_shell/decks/$deckId_/settings")({
  loader: ({ context: { queryClient }, params: { deckId } }) =>
    Promise.all([
      queryClient.ensureQueryData(deckQueryOptions(deckId)),
      queryClient.ensureQueryData(settingsQueryOptions()),
      queryClient.ensureQueryData(tuningQueryOptions()),
      ensureLibrary(queryClient),
    ]),
  component: DeckSettingsPage,
});

const SECTIONS: readonly Section[] = [
  { id: "retention", title: "Desired retention" },
  { id: "macros", title: "Math macros" },
  { id: "answer-mode", title: "Answer mode" },
  { id: "plan", title: "Plan" },
];

function DeckSettingsPage() {
  const { deckId } = Route.useParams();
  const { data: deck } = useSuspenseQuery(deckQueryOptions(deckId));
  // The section index stands in for the scrollbar.
  useHiddenScrollbar();
  return (
    <Page width="cards">
      {deck === null ? (
        <div className="flex flex-col gap-6">
          <DeckNotFound />
        </div>
      ) : (
        <Body key={deck.id} deck={deck} />
      )}
    </Page>
  );
}

function Body({ deck }: { deck: Deck }) {
  const library = useLibrary();
  const actions = usePlaceActions(library);
  return (
    <div className="lg:grid lg:grid-cols-[2rem_minmax(0,1fr)] lg:gap-8">
      <SectionIndex label="Deck settings sections" sections={SECTIONS} />
      <div className="flex flex-col gap-8 lg:gap-10">
        <div className="flex flex-col gap-4">
          <Breadcrumb
            library={library}
            at={deck.folderId}
            deck={{ id: deck.id, name: deck.name }}
            last="Settings"
            onMove={actions.drop}
          />
          <h1 className="text-[2.25rem] leading-none font-semibold tracking-[-0.035em] lg:text-5xl">
            Deck settings
          </h1>
          <p className="max-w-prose text-[1.05rem] text-muted-foreground">
            For <span className="font-medium text-foreground">{deck.name}</span>. Whatever this deck
            doesn't set for itself follows{" "}
            <Link to="/settings" className="text-foreground underline underline-offset-4">
              Settings
            </Link>
            .
          </p>
        </div>
        <DeckRetentionCard deck={deck} />
        <div className="gap-x-5 md:columns-2 lg:gap-x-6 [&>section]:mb-5 [&>section]:break-inside-avoid lg:[&>section]:mb-6">
          <DeckMacrosCard deck={deck} />
          <AnswerModeCard deck={deck} />
          <PlanCard deck={deck} />
        </div>
      </div>
      {actions.dialogs}
    </div>
  );
}
