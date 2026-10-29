import { useSuspenseQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Calculator, Flag, PencilLine } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { Breadcrumb } from "@/components/folders/breadcrumb";
import { usePlaceActions } from "@/components/folders/place-actions";
import { useLibrary } from "@/components/folders/use-library";
import { DeckNotFound } from "@/components/not-found";
import { Page } from "@/components/page";
import { GlobalRetentionPicker, RetentionError } from "@/components/settings/retention-picker";
import { SaveState } from "@/components/settings/parts";
import { type Section, SectionIndex } from "@/components/settings/section-index";
import { type Deck, deckQueryOptions } from "@/lib/decks";
import { ensureLibrary } from "@/lib/folders";
import { changeRetention, outOfTen, protoState, useRetention } from "@/lib/proto-retention";
import { useHiddenScrollbar } from "@/lib/use-hidden-scrollbar";
import { cn } from "@/lib/utils";

// PROTOTYPE (BAN-23, Variant b "Room"): a Deck's settings get a page of their
// own, built like Settings: the setting the page is about first, full width,
// then a card for each setting to come. Each one says whether it follows
// Settings, and a Deck's own value is one choice away from following again.

export const Route = createFileRoute("/_shell/decks/$deckId_/settings")({
  loader: ({ context: { queryClient }, params: { deckId } }) =>
    Promise.all([
      queryClient.ensureQueryData(deckQueryOptions(deckId)),
      ensureLibrary(queryClient),
    ]),
  component: DeckSettingsPage,
});

const SECTIONS: readonly Section[] = [
  { id: "retention", title: "Desired retention" },
  { id: "answer-mode", title: "Answer mode" },
  { id: "macros", title: "Math macros" },
  { id: "plan", title: "Plan" },
];

function DeckSettingsPage() {
  const { deckId } = Route.useParams();
  const { data: deck } = useSuspenseQuery(deckQueryOptions(deckId));
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
        <RetentionSection deckId={deck.id} />
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
            id="macros"
            title="Math macros"
            icon={<Calculator aria-hidden className="size-4" />}
            follows="Settings' macros"
          >
            Shorthands like <code className="font-mono text-[0.9em]">\R</code> for this deck's
            Formulas, on top of the ones in Settings.
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

/** Desired retention: follow Settings, or this deck's own value. */
function RetentionSection({ deckId }: { deckId: string }) {
  const { global, own, saveState } = useRetention();
  const value = own(deckId);
  const start = protoState();
  // Picking "Its own" before a value is chosen shows the picker, starting at Settings' value.
  const [ownChosen, setOwnChosen] = useState(start === "picking");
  const isOwn = value !== null || ownChosen;
  const shown = value ?? global;
  const label = useId();
  const hint = useId();
  const scope = { deck: deckId };
  const name = useId();

  return (
    <section
      id="retention"
      aria-labelledby="retention-title"
      className="flex scroll-mt-28 flex-col gap-6 rounded-[1.5rem] border bg-card p-5 text-card-foreground sm:p-7 lg:p-8"
    >
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-3">
          <h2 id="retention-title" className="text-xl font-semibold tracking-tight lg:text-2xl">
            Desired retention
          </h2>
          <SaveState state={saveState(scope)} />
        </div>
        <p className="max-w-prose text-[0.95rem] text-muted-foreground">
          Of every 10 cards that come due, you'll remember about {outOfTen(shown)}. Higher means
          more reviews; a change reschedules this deck's cards at once.
        </p>
      </div>

      <div role="radiogroup" aria-label="Desired retention" className="grid gap-3 sm:grid-cols-2">
        <Choice
          name={name}
          checked={!isOwn}
          onPick={() => {
            setOwnChosen(false);
            if (value !== null) changeRetention(scope, null);
          }}
          title="Follow Settings"
          detail={`${global}% now, and whatever Settings change it to.`}
        />
        <Choice
          name={name}
          checked={isOwn}
          onPick={() => setOwnChosen(true)}
          title="Its own"
          detail={
            value === null
              ? "Pick a percent for this deck alone."
              : `${value}% for this deck alone.`
          }
        />
      </div>

      {isOwn && (
        <div className="flex flex-col gap-2 rounded-xl bg-muted p-4 sm:max-w-sm">
          <span id={label} className="text-sm font-medium">
            This deck's Desired retention
          </span>
          {/* The percents alone: "Follow Settings" is the radio beside it. */}
          <GlobalRetentionPicker
            scope={scope}
            value={value}
            labelledBy={label}
            describedBy={hint}
            autoFocus={start === "picking"}
          />
          <p id={hint} className="text-sm text-muted-foreground">
            Whole percents from 70% to 97%.
          </p>
        </div>
      )}
      <RetentionError scope={scope} />
    </section>
  );
}

function Choice({
  name,
  checked,
  onPick,
  title,
  detail,
}: {
  name: string;
  checked: boolean;
  onPick: () => void;
  title: string;
  detail: string;
}) {
  return (
    <label
      className={cn(
        "flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors motion-reduce:transition-none has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring has-[:focus-visible]:outline-solid",
        checked ? "border-primary bg-accent" : "hover:bg-muted",
      )}
    >
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={onPick}
        className="mt-1 size-4 accent-[var(--primary)]"
      />
      <span className="flex flex-col gap-0.5">
        <span className={cn("font-medium", checked && "text-primary")}>{title}</span>
        <span className="text-sm text-muted-foreground">{detail}</span>
      </span>
    </label>
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
