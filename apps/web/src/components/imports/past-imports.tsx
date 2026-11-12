import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Undo2 } from "lucide-react";
import { DOT, RAIL, TIME_COL } from "@/components/cards/card-timeline";
import type { Deck } from "@/lib/decks";
import {
  cardCount,
  historyStateLabel,
  importHistoryQueryOptions,
  sourceLabel,
} from "@/lib/imports";
import { cn } from "@/lib/utils";

// Past imports, below the import page's source: the Deck's confirmed Imports
// on the same rail as the report, newest at the top, the day in the margin.
// Each is a card linking to its report; an undone one hangs dashed and faded,
// as a Duplicate does in the preview. With no confirmed Import, the section
// isn't there at all.

const H2 = "text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase";

const dayMark = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const timeOf = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

export function PastImports({ deck }: { deck: Deck }) {
  const { data: history } = useQuery(importHistoryQueryOptions(deck.id));
  if (history === undefined || history === null || history.length === 0) return null;
  return (
    <section aria-labelledby="past-imports" className="flex flex-col gap-4 pt-2">
      <h2 id="past-imports" className={cn(H2, "sm:pl-18")}>
        Past imports into {deck.name}
      </h2>
      <ol className="flex flex-col">
        {history.map((entry, i) => {
          const undone = entry.undoneAt !== null;
          const state = historyStateLabel(entry);
          return (
            <li key={entry.id} className="flex gap-3 sm:gap-4">
              <p
                className={cn(
                  TIME_COL,
                  "pt-3.5 text-right text-xs font-medium text-muted-foreground tabular-nums",
                )}
              >
                {dayMark(entry.confirmedAt)}
              </p>
              <div
                className={cn(
                  RAIL,
                  "min-w-0 flex-1 pb-3",
                  i === history.length - 1 && "border-dashed",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    DOT,
                    "top-[1.15rem]",
                    i === 0 && !undone ? "bg-primary" : "bg-input",
                  )}
                />
                <Link
                  to="/imports/$importId"
                  params={{ importId: entry.id }}
                  className={cn(
                    "flex flex-col gap-1 rounded-xl border bg-card px-4 py-3 text-foreground no-underline shadow-xs hover:border-ring/60",
                    undone && "border-dashed bg-transparent shadow-none",
                  )}
                >
                  <span className="flex items-baseline gap-3">
                    <span
                      className={cn(
                        "min-w-0 flex-1 font-medium [overflow-wrap:anywhere]",
                        undone && "text-muted-foreground",
                      )}
                    >
                      {entry.fileName}
                    </span>
                    <span
                      aria-label={`${entry.live} of ${cardCount(entry.imported)} here`}
                      className={cn(
                        "shrink-0 text-sm font-semibold tabular-nums",
                        undone || entry.live === 0 ? "text-muted-foreground" : "text-primary",
                      )}
                    >
                      {entry.live}
                      <span className="font-normal text-muted-foreground"> / {entry.imported}</span>
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span>
                      {sourceLabel(entry.source)} at {timeOf(entry.confirmedAt)}
                    </span>
                    <span>{cardCount(entry.imported)} imported</span>
                    {state !== undefined && (
                      <span
                        className={cn(
                          "flex items-center gap-1 font-medium",
                          undone && "text-foreground",
                        )}
                      >
                        {undone && <Undo2 aria-hidden className="size-3" />}
                        {state}
                      </span>
                    )}
                  </span>
                </Link>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
