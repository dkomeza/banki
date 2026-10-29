import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Flag, PencilLine } from "lucide-react";
import { type ReactNode, useId, useSyncExternalStore } from "react";
import { Breadcrumb } from "@/components/folders/breadcrumb";
import { usePlaceActions } from "@/components/folders/place-actions";
import { useLibrary } from "@/components/folders/use-library";
import { DeckNotFound } from "@/components/not-found";
import { Page } from "@/components/page";
import { DeckMacrosSection } from "@/components/settings/macros-ledger";
import { SaveState } from "@/components/settings/parts";
import { DeckRetentionPicker, RetentionError } from "@/components/settings/retention-picker";
import { RetentionPicture } from "@/components/settings/retention-picture";
import { type Section, SectionIndex } from "@/components/settings/section-index";
import { deckRetentionSaverFor, shownRetention } from "@/lib/deck-retention";
import { type Deck, deckQueryOptions } from "@/lib/decks";
import { ensureLibrary } from "@/lib/folders";
import { deckRetentionErrorText } from "@/lib/retention";
import { settingsQueryOptions } from "@/lib/settings";
import { useHiddenScrollbar } from "@/lib/use-hidden-scrollbar";

// A Deck's settings, on a page of their own built like Settings: the setting
// the page is about first, full width, then a card for each setting to come,
// which shows the page holds them. Desired retention is one picker whose first
// choice is Follow Settings, and a picture of ten cards coming due.

export const Route = createFileRoute("/_shell/decks/$deckId_/settings")({
  loader: ({ context: { queryClient }, params: { deckId } }) =>
    Promise.all([
      queryClient.ensureQueryData(deckQueryOptions(deckId)),
      queryClient.ensureQueryData(settingsQueryOptions()),
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
        <RetentionSection deck={deck} />
        <DeckMacrosSection deck={deck.id} />
        <div className="gap-x-5 md:columns-2 lg:gap-x-6 [&>section]:mb-5 [&>section]:break-inside-avoid lg:[&>section]:mb-6">
          <Later
            id="answer-mode"
            title="Answer mode"
            icon={<PencilLine aria-hidden className="size-4" />}
            follows="Rate yourself"
          >
            Whether this deck asks you to write your answers for the Grader, or to rate yourself.
          </Later>
          <Later
            id="plan"
            title="Plan"
            icon={<Flag aria-hidden className="size-4" />}
            follows="No Plan"
          >
            An exam date to work towards. While a Plan runs, it raises Desired retention as the day
            gets closer.
          </Later>
        </div>
      </div>
      {actions.dialogs}
    </div>
  );
}

/** Desired retention: the Deck's own, or Settings' while it follows them; saved as it changes. */
function RetentionSection({ deck }: { deck: Deck }) {
  const queryClient = useQueryClient();
  const global = useSuspenseQuery(settingsQueryOptions()).data.settings.desiredRetention;
  const saver = deckRetentionSaverFor(queryClient, deck.id);
  const state = useSyncExternalStore(saver.subscribe, saver.getState);
  const own = shownRetention(state, deck.desiredRetention);
  const value = own ?? global;
  const label = useId();
  const hint = useId();

  return (
    <section
      id="retention"
      aria-labelledby="retention-title"
      className="flex scroll-mt-28 flex-col gap-5 rounded-[1.5rem] border bg-card p-5 text-card-foreground sm:p-7 lg:p-8"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id="retention-title" className="text-xl font-semibold tracking-tight lg:text-2xl">
          Desired retention
        </h2>
        <SaveState state={state.queue.length > 0 ? "saving" : state.saved ? "saved" : undefined} />
      </div>
      <div className="flex max-w-xl flex-col gap-3">
        <span id={label} className="sr-only">
          This deck's Desired retention
        </span>
        <DeckRetentionPicker
          value={own}
          global={global}
          onPick={(picked) => saver.change(picked)}
          labelledBy={label}
          describedBy={hint}
        />
        <RetentionPicture percent={value} />
        <p id={hint} className="text-sm text-muted-foreground">
          {own === null
            ? `Follows Settings, ${global}% now. `
            : `Its own, whatever Settings say (${global}% now). `}
          Of every 100 of its cards that come due, you'll remember about {value}. Higher means more
          reviews; a change reschedules this deck's cards at once.
        </p>
        {state.failed !== undefined && (
          <RetentionError
            message={deckRetentionErrorText(state.failed.attempted, deck.desiredRetention, global)}
            onRetry={() => saver.retry()}
          />
        )}
      </div>
    </section>
  );
}

/** A setting to come: its card, what it will do, and what the deck does until then. */
function Later({
  id,
  title,
  icon,
  follows,
  children,
}: {
  id: string;
  title: string;
  icon: ReactNode;
  follows: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="flex scroll-mt-28 flex-col gap-3 rounded-[1.25rem] border border-dashed bg-card/60 p-5 text-card-foreground sm:p-6"
    >
      <div className="flex items-center justify-between gap-3">
        <h2
          id={`${id}-title`}
          className="flex items-center gap-2 text-xl font-semibold tracking-tight"
        >
          <span className="text-muted-foreground">{icon}</span>
          {title}
        </h2>
        <span className="rounded-full border px-3 py-1 text-xs text-muted-foreground">
          Coming later
        </span>
      </div>
      <p className="text-[0.95rem] text-muted-foreground">{children}</p>
      <p className="text-sm">
        <span className="text-muted-foreground">For now: </span>
        <span className="font-medium">{follows}</span>
        <span className="text-muted-foreground"> · follows Settings</span>
      </p>
    </section>
  );
}
