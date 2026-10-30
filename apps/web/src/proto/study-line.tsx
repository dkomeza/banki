import { Link } from "@tanstack/react-router";
import { Play } from "lucide-react";
import { OUTLINE_PILL, PILL } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import type { Deck } from "@/lib/decks";
import { cn } from "@/lib/utils";
import { estimateLabel, overviewFixture } from "./fixture";

// Variant a, Inline: the Study pill on a row of its own, with the counts as one
// quiet line of ink beside it. Nothing to study greys the pill and the line
// says when the next Cards come.

export function StudyLine({ deck }: { deck: Deck }) {
  const overview = overviewFixture();
  const nothing = overview.due === 0 && overview.new === 0;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-1">
      {nothing ? (
        <Button variant="outline" className={cn(OUTLINE_PILL, "h-11")} disabled>
          <Play aria-hidden />
          Study
        </Button>
      ) : (
        <Button
          className={cn(PILL, "h-11 text-primary-foreground no-underline")}
          render={<Link to="/decks/$deckId/study" params={{ deckId: deck.id }} />}
          nativeButton={false}
        >
          <Play aria-hidden />
          Study
        </Button>
      )}
      <p className="text-sm text-muted-foreground tabular-nums">
        {nothing ? (
          <>
            <span className="font-medium text-foreground">Nothing to study</span>
            {overview.nextDue !== null &&
              ` · next ${overview.nextDue.label}, ${overview.nextDue.count} cards`}
          </>
        ) : (
          <>
            <span className="font-medium text-foreground">{overview.due} due</span> ·{" "}
            <span className="font-medium text-foreground">{overview.new} new</span> ·{" "}
            {estimateLabel(overview.estimateMs)}
          </>
        )}
      </p>
    </div>
  );
}
