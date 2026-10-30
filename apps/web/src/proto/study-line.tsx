import { Link } from "@tanstack/react-router";
import { Play } from "lucide-react";
import { OUTLINE_PILL, PILL } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import type { Deck } from "@/lib/decks";
import { cn } from "@/lib/utils";
import { estimateLabel, overviewFixture } from "./fixture";

// Round 2 (b's card, c's data): what Study will bring is b's small card, and
// in it c's figures: the Cards Study will bring today, large in the accent,
// with the counts and estimate as its caption. The Study pill closes the row
// (under it, full width, on phones). Nothing to study says so in the figure's
// place, in ink, with when the next Cards come.

export function StudyLine({ deck }: { deck: Deck }) {
  const overview = overviewFixture();
  const nothing = overview.due === 0 && overview.new === 0;
  return (
    <section
      aria-label="Study"
      className="flex flex-col gap-4 rounded-2xl border bg-card p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:px-5"
    >
      {nothing ? (
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="text-lg font-semibold tracking-[-0.01em]">Nothing to study</p>
          <p className="text-sm text-muted-foreground tabular-nums">
            {overview.nextDue === null
              ? "No card is scheduled yet"
              : `Next ${overview.nextDue.label}, ${overview.nextDue.count} cards`}
          </p>
        </div>
      ) : (
        <div className="flex min-w-0 items-center gap-4">
          <span className="text-4xl leading-none font-semibold tracking-[-0.04em] text-primary tabular-nums">
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
        <Button variant="outline" className={cn(OUTLINE_PILL, "h-11 w-full sm:w-auto")} disabled>
          <Play aria-hidden />
          Study
        </Button>
      ) : (
        <Button
          className={cn(PILL, "h-11 w-full px-7 text-primary-foreground no-underline sm:w-auto")}
          render={<Link to="/decks/$deckId/study" params={{ deckId: deck.id }} />}
          nativeButton={false}
        >
          <Play aria-hidden />
          Study
        </Button>
      )}
    </section>
  );
}
