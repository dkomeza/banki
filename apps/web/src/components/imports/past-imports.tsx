import { Link } from "@tanstack/react-router";
import { FileJson, ClipboardPaste, FileArchive, Undo2 } from "lucide-react";
import type { Deck } from "@/lib/decks";
import { cn } from "@/lib/utils";
import { type HistoryEntry, stateLabel, useHistory, whenLabel } from "./prototype";

// Variant c, Receipts: each past Import is a small tile, like a receipt,
// its count the figure it is built around, two to a row from 640 px. An
// undone one is muted, its figure struck, with an Undone tag. With no
// confirmed Import, a dashed tile says where they will show.

const H2 = "text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase";

const SourceIcon = ({ source }: { source: HistoryEntry["source"] }) => {
  const Icon = source === "zip" ? FileArchive : source === "json" ? FileJson : ClipboardPaste;
  return <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />;
};

export function PastImports({ deck }: { deck: Deck }) {
  const history = useHistory(deck.id);
  if (history === undefined) return null;
  return (
    <section aria-labelledby="past" className="flex flex-col gap-3 border-t pt-6 lg:pt-8">
      <h2 id="past" className={H2}>
        Past imports
      </h2>
      {history.length === 0 ? (
        <p className="rounded-2xl border border-dashed px-4 py-5 text-center text-sm text-muted-foreground">
          Your imports into {deck.name} will show here, each with its report.
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {history.map((entry) => {
            const undone = entry.undoneAt !== null;
            const state = stateLabel(entry);
            return (
              <li key={entry.id}>
                <Link
                  to="/imports/$importId"
                  params={{ importId: entry.report.importId }}
                  search={entry.report.state === undefined ? {} : { state: entry.report.state }}
                  className={cn(
                    "flex h-full flex-col gap-3 rounded-2xl border bg-card p-4 text-foreground no-underline shadow-xs hover:border-ring/60",
                    undone && "bg-muted/50 shadow-none",
                  )}
                >
                  <span className="flex items-start justify-between gap-3">
                    <span className="flex items-baseline gap-1.5">
                      <span
                        className={cn(
                          "text-3xl leading-none font-semibold tracking-tight tabular-nums",
                          undone && "text-muted-foreground line-through decoration-2",
                        )}
                      >
                        {entry.imported}
                      </span>
                      <span className="text-sm text-muted-foreground">
                        {entry.imported === 1 ? "card" : "cards"}
                      </span>
                    </span>
                    {undone ? (
                      <span className="flex items-center gap-1 rounded-full bg-foreground px-2.5 py-1 text-xs font-medium text-background">
                        <Undo2 aria-hidden className="size-3" />
                        Undone
                      </span>
                    ) : (
                      state !== undefined && (
                        <span className="rounded-full border px-2.5 py-1 text-xs font-medium text-muted-foreground">
                          {state}
                        </span>
                      )
                    )}
                  </span>
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="flex min-w-0 items-center gap-2">
                      <SourceIcon source={entry.source} />
                      <span className="min-w-0 font-medium [overflow-wrap:anywhere]">
                        {entry.fileName}
                      </span>
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {whenLabel(entry.confirmedAt)}
                    </span>
                    {undone && <span className="text-sm text-muted-foreground">{state}</span>}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
