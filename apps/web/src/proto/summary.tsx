import { Link } from "@tanstack/react-router";
import { OUTLINE_PILL, PILL } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import type { Deck } from "@/lib/decks";
import { cn } from "@/lib/utils";
import { type Summary, cardsLabel, recallPercent, timeLabel } from "./fixture";

// Variant c, Headline: the summary is built around one figure, the Recall
// rate, very large in the accent; a Session of New cards only leads with the
// Cards learned instead. The other figures sit under it in a smaller row,
// then one sentence on what comes next. The actions dock to the bottom,
// stacked on phones, the main one on top.

export function SummaryView({ deck, summary }: { deck: Deck; summary: Summary }) {
  const early = summary.stillToStudy !== undefined;
  const offer = summary.newHeld > 0;
  const hero =
    summary.recall === null
      ? { value: String(summary.studied), label: "new cards learned", detail: undefined }
      : {
          value: `${recallPercent(summary.recall)}%`,
          label: "recall rate",
          detail: `${summary.recall.kept} of ${summary.recall.of} review cards recalled`,
        };
  const others = [
    ...(summary.recall === null
      ? []
      : [{ value: String(summary.studied), label: `cards · ${summary.newStudied} new` }]),
    { value: timeLabel(summary.timeMs), label: "spent" },
  ];
  const next = early
    ? `${summary.stillToStudy} still to study.`
    : summary.next === null
      ? "Nothing scheduled."
      : `Next: ${summary.next.label}, ${cardsLabel(summary.next.count)}.`;
  const primary = early ? "Keep studying" : offer ? `Learn ${summary.batch} more` : undefined;
  return (
    <>
      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center gap-8 px-6 pt-6 pb-10 text-center">
        <p className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
          {early ? "Session paused" : "Session done"}
        </p>
        <div className="flex flex-col items-center gap-2">
          <span className="text-[5.5rem] leading-none font-semibold tracking-[-0.05em] text-primary tabular-nums lg:text-[7rem]">
            {hero.value}
          </span>
          <span className="text-lg font-medium">{hero.label}</span>
          {hero.detail !== undefined && (
            <span className="text-sm text-muted-foreground tabular-nums">{hero.detail}</span>
          )}
        </div>
        <dl className="flex gap-10 border-t pt-6">
          {others.map((f) => (
            <div key={f.label} className="flex flex-col items-center">
              <dt className="sr-only">{f.label}</dt>
              <dd className="text-2xl font-semibold tracking-[-0.02em] tabular-nums">{f.value}</dd>
              <dd className="text-sm text-muted-foreground tabular-nums">{f.label}</dd>
            </div>
          ))}
        </dl>
        <p className="text-balance text-lg tabular-nums">
          {next}
          {offer && (
            <span className="text-muted-foreground"> {summary.newHeld} new cards are waiting.</span>
          )}
        </p>
      </div>
      <div className="sticky bottom-0 z-10 bg-background/95 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
        <div className="mx-auto flex w-full max-w-md flex-col gap-2 px-4 pt-3 sm:flex-row-reverse">
          {primary !== undefined && (
            <Button className={cn(PILL, "h-14 text-base sm:flex-1 tabular-nums lg:h-12")}>
              {primary}
            </Button>
          )}
          <Button
            variant={primary === undefined ? "default" : "outline"}
            className={cn(
              primary === undefined ? PILL : OUTLINE_PILL,
              "h-14 text-base sm:flex-1 no-underline lg:h-12",
              primary === undefined ? "text-primary-foreground" : "text-foreground",
            )}
            render={<Link to="/decks/$deckId" params={{ deckId: deck.id }} />}
            nativeButton={false}
          >
            Back to deck
          </Button>
        </div>
      </div>
    </>
  );
}
