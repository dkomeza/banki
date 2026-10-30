import { Link } from "@tanstack/react-router";
import { Play } from "lucide-react";
import { OUTLINE_PILL, PILL } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import type { Deck } from "@/lib/decks";
import { cn } from "@/lib/utils";
import { estimateLabel, overviewFixture } from "./fixture";

// Variant b, Ledger: what Study will bring is a small card of its own, the
// three figures side by side over their labels, with the Study pill closing
// the row (under it, full width, on phones). The other actions stay below.

export function StudyLine({ deck }: { deck: Deck }) {
  const overview = overviewFixture();
  const nothing = overview.due === 0 && overview.new === 0;
  return (
    <section
      aria-label="Study"
      className="flex flex-col gap-4 rounded-2xl border bg-card p-4 sm:flex-row sm:items-center sm:gap-6 sm:px-5"
    >
      {nothing ? (
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="font-semibold">Nothing to study</p>
          <p className="text-sm text-muted-foreground tabular-nums">
            {overview.nextDue === null
              ? "No card is scheduled yet."
              : `Next ${overview.nextDue.label}, ${overview.nextDue.count} cards`}
          </p>
        </div>
      ) : (
        <dl className="grid flex-1 grid-cols-3 gap-4 sm:flex sm:gap-8">
          {[
            { value: String(overview.due), label: "due" },
            { value: String(overview.new), label: "new" },
            { value: estimateLabel(overview.estimateMs), label: "estimated" },
          ].map((f) => (
            <div key={f.label} className="flex flex-col">
              <dd className="text-2xl font-semibold tracking-[-0.02em] tabular-nums">{f.value}</dd>
              <dt className="text-sm text-muted-foreground">{f.label}</dt>
            </div>
          ))}
        </dl>
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
