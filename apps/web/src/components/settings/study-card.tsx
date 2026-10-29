import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { useId } from "react";
import { GlobalRetentionPicker, RetentionError } from "@/components/settings/retention-picker";
import { SaveState, SettingsCard } from "@/components/settings/parts";
import { decksQueryOptions } from "@/lib/decks";
import { outOfTen, protoState, useRetention } from "@/lib/proto-retention";

// PROTOTYPE (BAN-23, Variant b "Room"): the Study card, with the global
// Desired retention and the Decks that don't follow it, each linking to its
// own settings page.

export function StudyCard() {
  const { global, saveState, decksWithOwn } = useRetention();
  const decks = useQuery(decksQueryOptions()).data ?? [];
  const label = useId();
  const hint = useId();
  const own = decks.flatMap((deck) => {
    const value = decksWithOwn[deck.id];
    return value === undefined ? [] : [{ deck, value }];
  });
  return (
    <SettingsCard id="study" title="Study">
      <div className="flex flex-col gap-2">
        <div className="flex min-h-5 items-center justify-between gap-3">
          <span id={label} className="text-sm font-medium">
            Desired retention
          </span>
          <SaveState state={saveState("global")} />
        </div>
        <GlobalRetentionPicker
          labelledBy={label}
          describedBy={hint}
          autoFocus={protoState() === "picking"}
        />
        <p id={hint} className="text-sm text-muted-foreground">
          Of every 10 cards that come due, you'll remember about {outOfTen(global)}. Higher means
          more reviews.
        </p>
        <RetentionError scope="global" />
      </div>
      <div className="flex flex-col gap-2 border-t pt-4">
        <p className="text-sm font-medium">Decks with their own</p>
        {own.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            None: every deck follows {global}%. A deck gets its own in its settings.
          </p>
        ) : (
          <ul className="-mx-2 flex flex-col">
            {own.map(({ deck, value }) => (
              <li key={deck.id}>
                <Link
                  to="/decks/$deckId/settings"
                  params={{ deckId: deck.id }}
                  className="flex min-h-11 items-center gap-3 rounded-lg px-2 text-[0.95rem] text-foreground no-underline hover:bg-muted lg:min-h-9"
                >
                  <span className="min-w-0 flex-1 truncate">{deck.name}</span>
                  <span className="font-medium tabular-nums">{value}%</span>
                  <ChevronRight aria-hidden className="size-4 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </SettingsCard>
  );
}
