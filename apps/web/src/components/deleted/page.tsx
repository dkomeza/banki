// Variant a, "Ledger": Recently deleted as one card of rows, like a ledger:
// each Deletion on a line with its facts under its name, and Restore and Delete
// permanently always in view beside it. Reached from its own nav item.
import { Archive, FileText, Folder, RotateCcw, Trash2 } from "lucide-react";
import { monogram } from "@/components/decks/cover";
import { KRAFT_BODY } from "@/components/folders/folder-tile";
import { Page } from "@/components/page";
import { OUTLINE_PILL } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import {
  type DeletedState,
  type Deletion,
  daysLeft,
  daysLeftLabel,
  deletedLabel,
  kindLabel,
  whereLabel,
  withLabel,
} from "@/lib/deletions-proto";
import { cn } from "@/lib/utils";
import { ConfirmRemove } from "./confirm-remove";
import { showRestoredToast } from "./toasts";
import { useDeletions } from "./use-deletions";

export function DeletedPage({ state }: { state: DeletedState | undefined }) {
  const { entries, restore, remove, confirming, setConfirming } = useDeletions(
    state,
    showRestoredToast,
  );
  return (
    <Page width="reading">
      <div className="flex flex-col gap-8 lg:gap-10">
        <header className="flex flex-col gap-3">
          <h1 className="text-[2.25rem] leading-[1.05] font-semibold tracking-[-0.035em] lg:text-5xl">
            Recently deleted
          </h1>
          <p className="max-w-prose text-[0.95rem] text-muted-foreground">
            Deleted folders, decks and cards wait here for 30 days, then they're removed for good.
          </p>
        </header>
        {entries.length === 0 ? (
          <Empty />
        ) : (
          <ul
            aria-label="Deletions"
            className="flex flex-col divide-y rounded-[1.25rem] border bg-card text-card-foreground"
          >
            {entries.map((d) => (
              <Entry
                key={d.id}
                deletion={d}
                onRestore={() => restore(d)}
                onRemove={() => setConfirming(d)}
              />
            ))}
          </ul>
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

function Entry({
  deletion: d,
  onRestore,
  onRemove,
}: {
  deletion: Deletion;
  onRestore: () => void;
  onRemove: () => void;
}) {
  const left = daysLeft(d.removesAt);
  const going = withLabel(d);
  return (
    <li className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:gap-5 sm:p-5">
      <div className="flex min-w-0 flex-1 items-start gap-4">
        <Glyph deletion={d} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="truncate text-[1.05rem] leading-snug font-semibold tracking-tight">
            {d.top.name}
          </p>
          <p className="text-sm text-pretty text-muted-foreground">
            {kindLabel(d.top.kind)} {d.top.kind === "card" ? "in" : "from"}{" "}
            <span className="text-foreground/80">{whereLabel(d)}</span>
            {going !== "" && <>, {going}</>}
          </p>
          <p className="text-sm text-muted-foreground">
            Deleted {whenLabel(d.deletedAt)} ·{" "}
            <span className={cn(left <= 3 && "font-medium text-primary")}>
              {daysLeftLabel(left)}
            </span>
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" className={cn(OUTLINE_PILL, "h-11 lg:h-9")} onClick={onRestore}>
          <RotateCcw aria-hidden />
          Restore
        </Button>
        <Button
          variant="ghost"
          className="h-11 rounded-full px-4 text-destructive hover:bg-destructive/10 hover:text-destructive lg:h-9"
          onClick={onRemove}
        >
          <Trash2 aria-hidden />
          <span className="sm:sr-only lg:not-sr-only">Delete permanently</span>
        </Button>
      </div>
    </li>
  );
}

/** "today, 10:00", "yesterday, 11:00", "on 22 Oct". */
function whenLabel(deletedAt: Date) {
  const when = deletedLabel(deletedAt);
  return /^\d/.test(when) ? `on ${when}` : when.charAt(0).toLowerCase() + when.slice(1);
}

/** A small picture of what went: a kraft folder, a deck's cover, or an index card. */
function Glyph({ deletion: d }: { deletion: Deletion }) {
  const box = "flex size-10 shrink-0 items-center justify-center rounded-xl border";
  if (d.top.kind === "deck")
    return (
      <span
        aria-hidden
        className={cn(box, "bg-muted text-sm font-semibold tracking-tight text-foreground/80")}
      >
        {monogram(d.top.name)}
      </span>
    );
  if (d.top.kind === "folder")
    return (
      <span aria-hidden className={cn(box, KRAFT_BODY, "border-black/10 dark:border-white/10")}>
        <Folder className="size-5 text-foreground/70" />
      </span>
    );
  return (
    <span aria-hidden className={cn(box, "bg-background")}>
      <FileText className="size-5 text-muted-foreground" />
    </span>
  );
}

function Empty() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-[1.25rem] border border-dashed px-6 py-16 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Archive aria-hidden className="size-5" />
      </span>
      <p className="text-lg font-semibold tracking-tight">Nothing deleted</p>
      <p className="max-w-sm text-[0.95rem] text-muted-foreground">
        When you delete a folder, deck or card, it waits here for 30 days, so you can restore it.
      </p>
    </div>
  );
}
