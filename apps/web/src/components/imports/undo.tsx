import { AlertDialog } from "@base-ui/react/alert-dialog";
import { LoaderCircle } from "lucide-react";
import { OUTLINE_PILL, PILL } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { type UndoFacts, cardCount } from "./prototype";

// Variant b: Undo asks in a sheet from the foot of a phone, centred from
// 640 px. The counts that make it weightier sit as three figures, the way
// the report counts its steps, each with its line under it.

export function UndoDialog({
  open,
  facts,
  busy,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  facts: UndoFacts;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const figures = [
    { n: facts.studied, label: "studied", note: "their reviews stay" },
    { n: facts.edited, label: "edited", note: "since the import" },
    { n: facts.moved, label: "moved", note: "to another deck, and go too" },
  ].filter((f) => f.n > 0);
  return (
    <AlertDialog.Root open={open} onOpenChange={(next) => !next && !busy && onCancel()}>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="fixed inset-0 z-40 bg-foreground/30 backdrop-blur-[2px] transition-opacity data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 motion-reduce:transition-none dark:bg-black/50" />
        <AlertDialog.Popup className="fixed inset-x-0 bottom-0 z-50 flex flex-col gap-5 rounded-t-[1.5rem] border bg-card px-5 pt-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] text-card-foreground shadow-xl transition-[opacity,translate] data-[ending-style]:translate-y-4 data-[ending-style]:opacity-0 data-[starting-style]:translate-y-4 data-[starting-style]:opacity-0 motion-reduce:transition-none sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:w-[min(32rem,calc(100vw-3rem))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[1.25rem] sm:p-6">
          <div className="flex flex-col gap-2">
            <AlertDialog.Title className="text-2xl font-semibold tracking-tight">
              Undo this import?
            </AlertDialog.Title>
            <AlertDialog.Description className="text-[0.95rem] text-muted-foreground">
              Its {cardCount(facts.live)} go to Recently deleted for 30 days.
            </AlertDialog.Description>
          </div>
          {figures.length > 0 && (
            <dl className="grid grid-cols-3 gap-2">
              {figures.map((f) => (
                <div key={f.label} className="flex flex-col gap-0.5 rounded-xl bg-muted/70 p-3">
                  <dt className="sr-only">{f.label}</dt>
                  <dd className="text-2xl font-semibold tabular-nums">{f.n}</dd>
                  <dd className="text-xs leading-snug text-muted-foreground">
                    <span className="font-medium text-foreground">{f.label}</span>, {f.note}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialog.Close
              render={
                <Button
                  variant="outline"
                  className={cn(OUTLINE_PILL, "h-11 lg:h-10")}
                  disabled={busy}
                />
              }
            >
              Cancel
            </AlertDialog.Close>
            <Button
              className={cn(
                PILL,
                "h-11 bg-destructive text-primary-foreground hover:bg-destructive/85 lg:h-10",
              )}
              disabled={busy}
              onClick={onConfirm}
            >
              {busy && (
                <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" />
              )}
              {busy ? "Undoing…" : "Undo import"}
            </Button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
