// Variant c, "Register": Recently deleted as a compact register, a table on
// wider screens, with Restore in view and Delete permanently in each row's ⋯
// menu, so the dangerous action takes a step more. A refused Restore opens a
// dialog that offers to restore the Deck first. Reached from Settings.
import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, FileText, Folder, Layers, Trash2 } from "lucide-react";
import { useState } from "react";
import { Page } from "@/components/page";
import { OUTLINE_PILL, PILL } from "@/components/settings/parts";
import { TileMenu } from "@/components/tile-menu";
import { Button } from "@/components/ui/button";
import {
  type DeletedState,
  type Deletion,
  type Kind,
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

const ICONS: Record<Kind, typeof Folder> = { folder: Folder, deck: Layers, card: FileText };

export function DeletedPage({ state }: { state: DeletedState | undefined }) {
  const [refused, setRefused] = useState<Deletion>();
  const { entries, restore, remove, confirming, setConfirming } = useDeletions(state, (d) => {
    if (d.restore.kind === "refused") setRefused(d);
    else showRestoredToast(d);
  });
  const deckFirst =
    refused?.restore.kind === "refused"
      ? entries.find(
          (e) => refused.restore.kind === "refused" && e.id === refused.restore.deletionId,
        )
      : undefined;

  return (
    <Page width="cards">
      <div className="flex flex-col gap-6 lg:gap-8">
        <header className="flex flex-col gap-3">
          <Link
            to="/settings"
            className="-ml-1 flex items-center gap-1 self-start text-sm text-muted-foreground no-underline hover:text-foreground"
          >
            <ChevronLeft aria-hidden className="size-4" />
            Settings
          </Link>
          <h1 className="text-[2.25rem] leading-[1.05] font-semibold tracking-[-0.035em] lg:text-5xl">
            Recently deleted
          </h1>
          <p className="max-w-prose text-[0.95rem] text-muted-foreground">
            {entries.length === 0
              ? "Nothing is waiting."
              : `${entries.length} ${entries.length === 1 ? "deletion" : "deletions"}, newest first. Each is removed for good 30 days after it was deleted.`}
          </p>
        </header>

        {entries.length === 0 ? (
          <Empty />
        ) : (
          <div className="overflow-hidden rounded-[1.25rem] border bg-card text-card-foreground">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="hidden border-b bg-muted/50 text-xs tracking-wide text-muted-foreground uppercase md:table-header-group">
                <tr>
                  <th className="py-3 pr-3 pl-5 font-medium">Name</th>
                  <th className="px-3 py-3 font-medium">Was in</th>
                  <th className="px-3 py-3 font-medium">Deleted</th>
                  <th className="px-3 py-3 font-medium">Removed in</th>
                  <th className="py-3 pr-5 pl-3">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {entries.map((d) => (
                  <Row
                    key={d.id}
                    deletion={d}
                    onRestore={() => restore(d)}
                    onRemove={() => setConfirming(d)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmRemove
        deletion={confirming}
        onCancel={() => setConfirming(undefined)}
        onConfirm={remove}
      />
      <Refused
        deletion={refused}
        deck={deckFirst}
        onClose={() => setRefused(undefined)}
        onRestoreDeck={(deck) => {
          setRefused(undefined);
          restore(deck);
        }}
      />
    </Page>
  );
}

function Row({
  deletion: d,
  onRestore,
  onRemove,
}: {
  deletion: Deletion;
  onRestore: () => void;
  onRemove: () => void;
}) {
  const Icon = ICONS[d.top.kind];
  const left = daysLeft(d.removesAt);
  const going = withLabel(d);
  const soon = left <= 3;
  return (
    <tr className="align-middle">
      <td className="py-3 pr-3 pl-4 md:pl-5">
        <div className="flex items-center gap-3">
          <span
            title={kindLabel(d.top.kind)}
            className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
          >
            <Icon aria-hidden className="size-4" />
            <span className="sr-only">{kindLabel(d.top.kind)}</span>
          </span>
          <div className="flex min-w-0 flex-col">
            <span className="truncate font-medium">{d.top.name}</span>
            <span className="truncate text-xs text-muted-foreground">
              {going === "" ? kindLabel(d.top.kind) : `${kindLabel(d.top.kind)} ${going}`}
              <span className="md:hidden"> · {whereLabel(d)}</span>
            </span>
            <span className="text-xs text-muted-foreground md:hidden">
              {deletedLabel(d.deletedAt)} ·{" "}
              <span className={cn(soon && "font-medium text-primary")}>{daysLeftLabel(left)}</span>
            </span>
          </div>
        </div>
      </td>
      <td className="hidden px-3 py-3 text-muted-foreground md:table-cell">{whereLabel(d)}</td>
      <td className="hidden px-3 py-3 whitespace-nowrap text-muted-foreground md:table-cell">
        {deletedLabel(d.deletedAt)}
      </td>
      <td className="hidden px-3 py-3 whitespace-nowrap md:table-cell">
        <span
          className={cn(
            "rounded-full px-2.5 py-1 text-xs tabular-nums",
            soon ? "bg-primary/12 font-medium text-primary" : "bg-muted text-muted-foreground",
          )}
        >
          {daysLeftLabel(left)}
        </span>
      </td>
      <td className="py-3 pr-3 pl-1 md:pr-5 md:pl-3">
        <div className="flex items-center justify-end gap-1">
          <Button
            variant="ghost"
            className="h-11 rounded-full px-3 font-medium text-primary hover:bg-primary/10 hover:text-primary lg:h-9"
            onClick={onRestore}
          >
            Restore
          </Button>
          <TileMenu
            label={`More for ${d.top.name}`}
            className="bg-transparent shadow-none lg:opacity-100"
            actions={[
              {
                label: "Delete permanently",
                icon: <Trash2 aria-hidden />,
                danger: true,
                onClick: onRemove,
              },
            ]}
          />
        </div>
      </td>
    </tr>
  );
}

/** A Card whose Deck is deleted: say so, and offer to restore the Deck. */
function Refused({
  deletion,
  deck,
  onClose,
  onRestoreDeck,
}: {
  deletion: Deletion | undefined;
  deck: Deletion | undefined;
  onClose: () => void;
  onRestoreDeck: (deck: Deletion) => void;
}) {
  const name = deletion?.restore.kind === "refused" ? deletion.restore.deck : "";
  return (
    <AlertDialog.Root open={deletion !== undefined} onOpenChange={(open) => !open && onClose()}>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="fixed inset-0 z-40 bg-foreground/30 backdrop-blur-[2px] transition-opacity data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 motion-reduce:transition-none dark:bg-black/50" />
        <AlertDialog.Popup className="fixed top-1/2 left-1/2 z-50 flex w-[min(28rem,calc(100vw-2.5rem))] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-[1.25rem] border bg-card p-6 text-card-foreground shadow-xl transition-[opacity,scale] data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0 motion-reduce:transition-none">
          <AlertDialog.Title className="text-xl font-semibold tracking-tight">
            Restore {name} first
          </AlertDialog.Title>
          <AlertDialog.Description className="text-[0.95rem] text-muted-foreground">
            “{deletion?.top.name}” was in {name}, which is deleted too. A card can only come back
            into its deck: restore {name}, then this card.
          </AlertDialog.Description>
          <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialog.Close render={<Button variant="outline" className={OUTLINE_PILL} />}>
              Not now
            </AlertDialog.Close>
            {deck !== undefined && (
              <Button className={PILL} onClick={() => onRestoreDeck(deck)}>
                Restore {name}
              </Button>
            )}
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

function Empty() {
  return (
    <div className="flex flex-col items-start gap-2 rounded-[1.25rem] border bg-card p-6">
      <p className="text-lg font-semibold tracking-tight">Nothing deleted</p>
      <p className="max-w-md text-[0.95rem] text-muted-foreground">
        Deleted folders, decks and cards wait here for 30 days, so you can restore them. After that
        they're removed for good.
      </p>
      <Link to="/" className="mt-2 text-sm font-medium text-primary">
        Back to Decks
      </Link>
    </div>
  );
}
