import { Link } from "@tanstack/react-router";
import { Play } from "lucide-react";
import { OUTLINE_PILL, PILL } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import type { Deck } from "@/lib/decks";
import { cn } from "@/lib/utils";
import { estimateLabel, overviewFixture } from "./fixture";

// Variant c, Headline: the deck page leads with one figure, the Cards Study
// will bring today, large in the accent, with the counts and estimate as its
// caption and the Study pill beside it. Nothing to study says so in the
// figure's place, in ink, with when the next Cards come.

export function StudyLine({ deck }: { deck: Deck }) {
  const overview = overviewFixture();
  const nothing = overview.due === 0 && overview.new === 0;
  return (
    <div className="flex flex-col gap-4 border-y py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      {nothing ? (
        <div className="flex flex-col gap-0.5">
          <p className="text-2xl font-semibold tracking-[-0.02em]">Nothing to study</p>
          <p className="text-sm text-muted-foreground tabular-nums">
            {overview.nextDue === null
              ? "No card is scheduled yet"
              : `Next ${overview.nextDue.label}, ${overview.nextDue.count} cards`}
          </p>
        </div>
      ) : (
        <div className="flex items-center gap-4">
          <span className="text-5xl leading-none font-semibold tracking-[-0.04em] text-primary tabular-nums">
            {overview.due + overview.new}
          </span>
          <div className="flex flex-col gap-0.5">
            <p className="font-semibold">cards today</p>
            <p className="text-sm text-muted-foreground tabular-nums">
              {overview.due} due · {overview.new} new · {estimateLabel(overview.estimateMs)}
            </p>
          </div>
        </div>
      )}
      {nothing ? (
        <Button variant="outline" className={cn(OUTLINE_PILL, "h-12 px-7 text-base")} disabled>
          <Play aria-hidden />
          Study
        </Button>
      ) : (
        <Button
          className={cn(PILL, "h-12 px-7 text-base text-primary-foreground no-underline lg:h-11")}
          render={<Link to="/decks/$deckId/study" params={{ deckId: deck.id }} />}
          nativeButton={false}
        >
          <Play aria-hidden />
          Study
        </Button>
      )}
    </div>
  );
}
