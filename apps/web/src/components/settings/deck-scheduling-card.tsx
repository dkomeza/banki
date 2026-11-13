import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { SettingsCard } from "@/components/settings/parts";
import type { Deck } from "@/lib/decks";
import { deckSchedulingLine, deckTuningQueryOptions } from "@/lib/tuning";

/**
 * Deck settings' Scheduling card (ADR-0033), read-only and in plain words:
 * whether Banki's scheduling is fitted to this Deck or follows the overall
 * fit, and why. Tune now and Reset to defaults stay in Settings → Advanced.
 * The page doesn't wait for, or fail on, the Deck's Tuning status.
 */
export function DeckSchedulingCard({ deck }: { deck: Deck }) {
  const { data: status, isError } = useQuery(deckTuningQueryOptions(deck.id));

  return (
    <SettingsCard id="scheduling" title="Scheduling">
      <div className="flex flex-col gap-2">
        <p className="text-[0.95rem] text-pretty" aria-live="polite">
          {status === undefined || status === null
            ? isError
              ? "Couldn't load how this deck is scheduled."
              : "Loading…"
            : deckSchedulingLine(status)}
        </p>
        <p className="text-sm text-muted-foreground">
          Banki checks it each time it checks your overall scheduling, every 200 reviews.
        </p>
        <Link
          to="/settings"
          hash="advanced"
          className="inline-flex min-h-11 items-center self-start text-sm text-foreground underline underline-offset-4 lg:min-h-0"
        >
          Tune now and Reset are in Settings → Advanced
        </Link>
      </div>
    </SettingsCard>
  );
}
