import { useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useId, useSyncExternalStore } from "react";
import { SaveState } from "@/components/settings/parts";
import {
  DeckRetentionPicker,
  RecommendedRetention,
  RetentionError,
} from "@/components/settings/retention-picker";
import { RetentionPicture } from "@/components/settings/retention-picture";
import { deckRetentionSaverFor, shownRetention } from "@/lib/deck-retention";
import type { Deck } from "@/lib/decks";
import { deckRetentionErrorText } from "@/lib/retention";
import { settingsQueryOptions } from "@/lib/settings";
import { deckTuningQueryOptions } from "@/lib/tuning";

/**
 * Desired retention: the Deck's own, or Settings' while it follows them, with
 * the Recommended retention, whose Use gives the Deck its own; saved as it
 * changes. The recommendation is the Deck's own while it has Parameters of
 * its own, and the overall one otherwise (ADR-0033).
 */
export function DeckRetentionCard({ deck }: { deck: Deck }) {
  const queryClient = useQueryClient();
  const global = useSuspenseQuery(settingsQueryOptions()).data.settings.desiredRetention;
  // The page doesn't wait for, or fail on, the Deck's Tuning status: until it
  // loads, and if it can't, there is no Recommended retention to show.
  const deckTuning = useQuery(deckTuningQueryOptions(deck.id)).data;
  const recommended = deckTuning?.recommendedRetention ?? null;
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
          recommended={recommended}
          onPick={(picked) => saver.change(picked)}
          labelledBy={label}
          describedBy={hint}
        />
        <RecommendedRetention
          percent={recommended}
          current={value}
          onUse={(picked) => saver.change(picked)}
          forDeck={deckTuning?.parameters === "own"}
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
