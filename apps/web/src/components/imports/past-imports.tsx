import { Link } from "@tanstack/react-router";
import { ChevronRight, Undo2 } from "lucide-react";
import type { Deck } from "@/lib/decks";
import { cn } from "@/lib/utils";
import { cardCount, sourceLabel, stateLabel, useHistory, whenLabel } from "./prototype";

// Variant a, Ledger: Past imports as one section card under the source, a
// row per Import split by hairlines: its file, when and state on the left,
// its count on the right, the whole row a link to its report. With no
// confirmed Import, the card stays, with a one-line note.

export function PastImports({ deck }: { deck: Deck }) {
  const history = useHistory(deck.id);
  if (history === undefined) return null;
  return (
    <section aria-labelledby="past" className="flex flex-col rounded-2xl border bg-card shadow-xs">
      <div className="flex items-baseline justify-between gap-3 px-4 pt-4 pb-2 sm:px-5">
        <h2 id="past" className="text-lg font-semibold tracking-tight">
          Past imports
        </h2>
        {history.length > 0 && (
          <span className="text-sm text-muted-foreground tabular-nums">{history.length}</span>
        )}
      </div>
      {history.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-muted-foreground sm:px-5">
          Nothing imported into {deck.name} yet. Each import you confirm is listed here.
        </p>
      ) : (
        <ul className="flex flex-col pb-1.5">
          {history.map((entry) => {
            const state = stateLabel(entry);
            const undone = entry.undoneAt !== null;
            return (
              <li key={entry.id} className="border-t first:border-t-0 sm:mx-1.5">
                <Link
                  to="/imports/$importId"
                  params={{ importId: entry.report.importId }}
                  search={entry.report.state === undefined ? {} : { state: entry.report.state }}
                  className="flex min-h-16 items-center gap-3 rounded-xl px-4 py-3 text-foreground no-underline hover:bg-muted/70 sm:px-3.5"
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span
                      className={cn(
                        "font-medium [overflow-wrap:anywhere]",
                        undone && "text-muted-foreground",
                      )}
                    >
                      {entry.fileName}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {sourceLabel(entry.source)} · {whenLabel(entry.confirmedAt)}
                    </span>
                    {state !== undefined && (
                      <span
                        className={cn(
                          "flex items-center gap-1 text-sm",
                          undone ? "font-medium text-foreground" : "text-muted-foreground",
                        )}
                      >
                        {undone && <Undo2 aria-hidden className="size-3" />}
                        {state}
                      </span>
                    )}
                  </span>
                  <span className="flex shrink-0 self-start pt-0.5 text-right">
                    <span
                      className={cn(
                        "font-medium tabular-nums",
                        undone && "text-muted-foreground line-through decoration-1",
                      )}
                    >
                      {cardCount(entry.imported)}
                    </span>
                  </span>
                  <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
