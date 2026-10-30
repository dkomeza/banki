import { Link } from "@tanstack/react-router";
import { OUTLINE_PILL, PILL } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import type { Deck } from "@/lib/decks";
import { cn } from "@/lib/utils";
import { type Summary, cardsLabel, recallPercent, timeLabel } from "./fixture";

// Variant a, Inline: the summary keeps BAN-26's quiet centred end. A title,
// then the figures as a row of numbers over small labels, the next-due line
// under them, and the actions as pills.

export function SummaryView({ deck, summary }: { deck: Deck; summary: Summary }) {
  const early = summary.stillToStudy !== undefined;
  const offer = summary.newHeld > 0;
  const figures = [
    { value: String(summary.studied), label: `cards · ${summary.newStudied} new` },
    ...(summary.recall === null
      ? []
      : [
          {
            value: `${recallPercent(summary.recall)}%`,
            label: `recall · ${summary.recall.kept} of ${summary.recall.of}`,
          },
        ]),
    { value: timeLabel(summary.timeMs), label: "spent" },
  ];
  return (
    <div className="mx-auto flex w-full max-w-lg flex-1 flex-col items-center justify-center gap-8 px-6 pb-24 text-center">
      <h1 className="text-[1.85rem] leading-tight font-semibold tracking-[-0.02em] lg:text-4xl">
        {early ? "Session paused" : "Done for now"}
      </h1>
      <dl className="flex w-full justify-center gap-6 sm:gap-10">
        {figures.map((f) => (
          <div key={f.label} className="flex min-w-0 flex-col items-center gap-1">
            <dt className="sr-only">{f.label}</dt>
            <dd className="text-3xl font-semibold tracking-[-0.02em] tabular-nums lg:text-4xl">
              {f.value}
            </dd>
            <dd className="text-xs text-muted-foreground tabular-nums sm:text-sm">{f.label}</dd>
          </div>
        ))}
      </dl>
      <p className="text-balance text-muted-foreground tabular-nums">
        {early
          ? `${summary.stillToStudy} still to study`
          : summary.next === null
            ? "Nothing scheduled"
            : `Next: ${summary.next.label}, ${cardsLabel(summary.next.count)}`}
        {offer && (
          <>
            <br />
            {summary.newHeld} new cards are waiting.
          </>
        )}
      </p>
      <div className="flex flex-wrap justify-center gap-3">
        {early && (
          <Button className={cn(PILL, "h-12 px-7 text-base lg:h-11")}>Keep studying</Button>
        )}
        {offer && (
          <Button className={cn(PILL, "h-12 px-7 text-base tabular-nums lg:h-11")}>
            Learn {summary.batch} more
          </Button>
        )}
        <Button
          variant={early || offer ? "outline" : "default"}
          className={cn(
            early || offer ? OUTLINE_PILL : PILL,
            "h-12 px-7 text-base no-underline lg:h-11",
            early || offer ? "text-foreground" : "text-primary-foreground",
          )}
          render={<Link to="/decks/$deckId" params={{ deckId: deck.id }} />}
          nativeButton={false}
        >
          Back to deck
        </Button>
      </div>
    </div>
  );
}
