// Recently deleted, as a shelf: each Deletion a tile, grouped by when it was
// deleted, with a faded picture of what went and a bar that empties as its 30
// days run out. A refused Restore says why inside its tile and points at what
// to restore first. Reached from the foot of Home.
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { ArrowUp, FileText, Folder, RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { DeckMacros } from "@/components/cards/deck-macros";
import { CardLine } from "@/components/cards/card-text";
import { monogram } from "@/components/decks/cover";
import { KRAFT_BODY, KRAFT_TAB } from "@/components/folders/folder-tile";
import { Page } from "@/components/page";
import { OUTLINE_PILL } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import {
  type Deletion,
  agoLabel,
  daysLeft,
  daysLeftLabel,
  deletionsQueryOptions,
  groupOf,
  kindLabel,
  nameOf,
  removeDeletion,
  restoreDeletion,
  whereLabel,
  withLabel,
} from "@/lib/deletions";
import { cn } from "@/lib/utils";
import { ConfirmRemove } from "./confirm-remove";
import { showRestoredToast } from "./toasts";

/** The Deck a refused Restore names, which must be restored first. */
type Refusal = { id: string; name: string };

export function DeletedPage() {
  const queryClient = useQueryClient();
  const { data: entries } = useSuspenseQuery(deletionsQueryOptions());
  const [refused, setRefused] = useState<ReadonlyMap<string, Refusal>>(new Map());
  const [restoring, setRestoring] = useState<string>();
  const [pointed, setPointed] = useState<string>();
  const [confirming, setConfirming] = useState<Deletion>();

  // The time the page was opened: what it says stays put while it is open.
  const [now] = useState(() => new Date());
  const groups: { title: string; items: Deletion[] }[] = [];
  for (const d of entries) {
    const title = groupOf(d.deletedAt, now);
    const last = groups.at(-1);
    if (last?.title === title) last.items.push(d);
    else groups.push({ title, items: [d] });
  }

  const restore = async (d: Deletion) => {
    setRestoring(d.id);
    const outcome = await restoreDeletion(queryClient, d.id);
    setRestoring(undefined);
    if (outcome.ok) {
      // It may be the Deck a refusal named: those Restores can be tried again.
      setRefused(new Map());
      showRestoredToast(outcome.restored, nameOf(d), whereLabel(d));
    } else if ("placeDeleted" in outcome) {
      setRefused((all) => new Map(all).set(d.id, outcome.placeDeleted));
    } else toast.error(outcome.message);
  };

  const remove = async (d: Deletion) => {
    const outcome = await removeDeletion(queryClient, d.id);
    if (!outcome.ok) return outcome.message;
    setConfirming(undefined);
    return undefined;
  };

  /** The Deck's own entry, when it was deleted on its own. */
  const entryOf = (deck: Refusal) =>
    entries.find((e) => e.top.kind === "deck" && e.top.id === deck.id);

  const point = (id: string) => {
    setPointed(id);
    document
      .getElementById(`deletion-${id}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <Page width="cards">
      <div className="flex flex-col gap-8 lg:gap-10">
        <header className="flex flex-col gap-3 border-b pb-6">
          <h1 className="text-[2.25rem] leading-[1.05] font-semibold tracking-[-0.035em] lg:text-5xl">
            Recently deleted
          </h1>
          <p className="max-w-prose text-[0.95rem] text-muted-foreground">
            What you delete waits here for 30 days. Restore it, or let it go.
          </p>
        </header>
        {entries.length === 0 ? (
          <Empty />
        ) : (
          groups.map((g) => (
            <section key={g.title} aria-label={g.title} className="flex flex-col gap-4">
              <h2 className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
                {g.title}
              </h2>
              <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {g.items.map((d) => {
                  const refusal = refused.get(d.id);
                  const deckEntry = refusal && entryOf(refusal);
                  return (
                    <Tile
                      key={d.id}
                      deletion={d}
                      now={now}
                      refusal={refusal}
                      busy={restoring === d.id}
                      pointed={pointed === d.id}
                      onRestore={() => void restore(d)}
                      onRemove={() => setConfirming(d)}
                      onPoint={deckEntry && (() => point(deckEntry.id))}
                    />
                  );
                })}
              </ul>
            </section>
          ))
        )}
      </div>
      <ConfirmRemove
        deletion={confirming}
        onCancel={() => setConfirming(undefined)}
        onConfirm={remove}
      />
    </Page>
  );
}

function Tile({
  deletion: d,
  now,
  refusal,
  busy,
  pointed,
  onRestore,
  onRemove,
  onPoint,
}: {
  deletion: Deletion;
  now: Date;
  refusal: Refusal | undefined;
  busy: boolean;
  pointed: boolean;
  onRestore: () => void;
  onRemove: () => void;
  onPoint: (() => void) | undefined;
}) {
  const name = nameOf(d);
  const going = withLabel(d);
  return (
    <li
      id={`deletion-${d.id}`}
      className={cn(
        "flex flex-col gap-4 rounded-[1.25rem] border bg-card p-4 text-card-foreground transition-shadow motion-reduce:transition-none",
        pointed && "ring-2 ring-primary ring-offset-2 ring-offset-background",
      )}
    >
      <div className="flex items-start gap-4">
        <Picture deletion={d} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {kindLabel(d.top.kind)} · {agoLabel(d.deletedAt, now)}
          </p>
          {d.top.kind === "card" ? (
            // Its Front renders with its Deck's Macros, even once that Deck is deleted.
            <DeckMacros own={d.deck?.macros}>
              <CardLine text={d.top.name} className="leading-snug font-semibold tracking-tight" />
            </DeckMacros>
          ) : (
            <p className="line-clamp-2 leading-snug font-semibold tracking-tight [overflow-wrap:anywhere]">
              {name}
            </p>
          )}
          <p className="truncate text-sm text-muted-foreground">
            {d.top.kind === "card" ? "In " : "From "}
            {whereLabel(d)}
          </p>
          {going !== "" && <p className="text-sm text-muted-foreground">{going}</p>}
        </div>
      </div>

      {refusal !== undefined && (
        <div role="alert" className="flex flex-col gap-2 rounded-xl bg-muted p-3 text-sm">
          <p>
            <span className="font-medium">Restore {refusal.name} first.</span>{" "}
            <span className="text-muted-foreground">
              This card can only come back into its deck, which is deleted too.
            </span>
          </p>
          {onPoint !== undefined && (
            <Button
              variant="outline"
              className={cn(OUTLINE_PILL, "h-11 self-start lg:h-9")}
              onClick={onPoint}
            >
              <ArrowUp aria-hidden />
              Show {refusal.name}
            </Button>
          )}
        </div>
      )}

      {/* At the foot of every tile, however little is above it. */}
      <Countdown left={daysLeft(d.removesAt, now)} className="mt-auto" />

      <div className="flex items-center justify-between gap-2 border-t pt-3">
        <Button
          variant="outline"
          className={cn(OUTLINE_PILL, "h-11 lg:h-9")}
          disabled={busy}
          onClick={onRestore}
        >
          <RotateCcw aria-hidden />
          {busy ? "Restoring…" : "Restore"}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Delete ${name} permanently`}
          title="Delete permanently"
          className="size-11 rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive lg:size-9"
          onClick={onRemove}
        >
          <Trash2 aria-hidden />
        </Button>
      </div>
    </li>
  );
}

/** A bar that empties over the 30 days, with the days left beside it. */
function Countdown({ left, className }: { left: number; className?: string }) {
  const soon = left <= 3;
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div
        className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
        role="meter"
        aria-label="Time left before removal"
        aria-valuemin={0}
        aria-valuemax={30}
        aria-valuenow={left}
      >
        <div
          className={cn("h-full rounded-full", soon ? "bg-primary" : "bg-foreground/35")}
          style={{ width: `${(left / 30) * 100}%` }}
        />
      </div>
      <span
        className={cn(
          "shrink-0 text-sm tabular-nums",
          soon ? "font-medium text-primary" : "text-muted-foreground",
        )}
      >
        {daysLeftLabel(left)}
      </span>
    </div>
  );
}

/** A faded picture of what went: a kraft folder, a deck's cover, or an index card. */
function Picture({ deletion: d }: { deletion: Deletion }) {
  const frame = "relative flex h-14 w-16 shrink-0 opacity-70 grayscale-[35%]";
  if (d.top.kind === "folder")
    return (
      <span aria-hidden className={cn(frame, "flex-col")}>
        <span
          className={cn(
            "h-2.5 w-7 rounded-t-md border border-b-0 border-black/10 dark:border-white/10",
            KRAFT_TAB,
          )}
        />
        <span
          className={cn(
            "flex flex-1 items-center justify-center rounded-lg rounded-tl-none border border-black/10 dark:border-white/10",
            KRAFT_BODY,
          )}
        >
          <Folder className="size-4 text-foreground/50" />
        </span>
      </span>
    );
  if (d.top.kind === "deck")
    return (
      <span aria-hidden className={frame}>
        <span className="absolute inset-0 translate-x-1 translate-y-1 rotate-[2deg] rounded-lg border border-dashed bg-muted" />
        <span className="relative flex flex-1 items-end rounded-lg border border-dashed bg-[repeating-linear-gradient(to_bottom,transparent_0,transparent_calc(0.75rem-1px),color-mix(in_oklch,var(--foreground)_8%,transparent)_calc(0.75rem-1px),color-mix(in_oklch,var(--foreground)_8%,transparent)_0.75rem)] bg-card p-1.5 text-sm leading-none font-semibold tracking-tight">
          {monogram(d.top.name)}
        </span>
      </span>
    );
  return (
    <span aria-hidden className={frame}>
      <span className="flex flex-1 items-center justify-center rounded-md border border-dashed bg-background">
        <FileText className="size-5 text-muted-foreground" />
      </span>
    </span>
  );
}

function Empty() {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-20 text-center">
      <span className="flex size-14 items-center justify-center rounded-2xl border border-dashed text-muted-foreground">
        <Trash2 aria-hidden className="size-6" />
      </span>
      <p className="text-lg font-semibold tracking-tight">The shelf is empty</p>
      <p className="max-w-sm text-[0.95rem] text-muted-foreground">
        Deleted folders, decks and cards wait here for 30 days before they're removed for good.
      </p>
    </div>
  );
}
