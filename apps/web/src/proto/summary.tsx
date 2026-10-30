import { Link } from "@tanstack/react-router";
import { OUTLINE_PILL, PILL } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import type { Deck } from "@/lib/decks";
import { cn } from "@/lib/utils";
import { type Summary, cardsLabel, recallPercent, timeLabel } from "./fixture";

// Variant b, Ledger: the summary reads like a receipt. A left-aligned title,
// then one row per figure, its label on the left and its value on the right,
// between hairlines, the next-due row last. The actions dock to the bottom
// like Show answer and the ratings did, in the same place and thumb reach.

export function SummaryView({ deck, summary }: { deck: Deck; summary: Summary }) {
  const early = summary.stillToStudy !== undefined;
  const offer = summary.newHeld > 0;
  const rows: { label: string; value: string; detail?: string; accent?: boolean }[] = [
    {
      label: "Cards studied",
      value: String(summary.studied),
      detail: `${summary.newStudied} new`,
    },
    ...(summary.recall === null
      ? []
      : [
          {
            label: "Recall rate",
            value: `${recallPercent(summary.recall)}%`,
            detail: `${summary.recall.kept} of ${summary.recall.of}`,
          },
        ]),
    { label: "Time spent", value: timeLabel(summary.timeMs) },
    early
      ? { label: "Still to study", value: cardsLabel(summary.stillToStudy ?? 0), accent: true }
      : summary.next === null
        ? { label: "Next", value: "Nothing scheduled" }
        : {
            label: "Next",
            value: summary.next.label.charAt(0).toUpperCase() + summary.next.label.slice(1),
            detail: cardsLabel(summary.next.count),
            accent: true,
          },
  ];
  return (
    <>
      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-6 px-6 pt-6 pb-10 sm:px-10">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-muted-foreground">
            {early ? "You left early" : "The Queue is done"}
          </p>
          <h1 className="text-[2.25rem] leading-[1.05] font-semibold tracking-[-0.035em] lg:text-5xl">
            {early ? "Session paused" : "Session done"}
          </h1>
        </div>
        <dl className="flex flex-col border-t">
          {rows.map((row) => (
            <div
              key={row.label}
              className="flex items-baseline justify-between gap-4 border-b py-4 tabular-nums"
            >
              <dt className="text-muted-foreground">{row.label}</dt>
              <dd className="flex items-baseline gap-2 text-right">
                {row.detail !== undefined && (
                  <span className="text-sm text-muted-foreground">{row.detail}</span>
                )}
                <span
                  className={cn(
                    "text-xl font-semibold tracking-[-0.01em]",
                    row.accent && "text-primary",
                  )}
                >
                  {row.value}
                </span>
              </dd>
            </div>
          ))}
        </dl>
        {offer && (
          <p className="text-muted-foreground tabular-nums">
            {summary.newHeld} new cards are waiting.
          </p>
        )}
      </div>
      <div className="sticky bottom-0 z-10 border-t bg-background/95 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
        <div className="mx-auto flex w-full max-w-2xl gap-2 px-3 pt-3 sm:px-6">
          <Button
            variant={early || offer ? "outline" : "default"}
            className={cn(
              early || offer ? OUTLINE_PILL : PILL,
              "h-14 flex-1 text-base no-underline lg:h-12",
              early || offer ? "text-foreground" : "text-primary-foreground",
            )}
            render={<Link to="/decks/$deckId" params={{ deckId: deck.id }} />}
            nativeButton={false}
          >
            Back to deck
          </Button>
          {early && (
            <Button className={cn(PILL, "h-14 flex-1 text-base lg:h-12")}>Keep studying</Button>
          )}
          {offer && (
            <Button className={cn(PILL, "h-14 flex-1 text-base tabular-nums lg:h-12")}>
              Learn {summary.batch} more
            </Button>
          )}
        </div>
      </div>
    </>
  );
}
