import { AlertDialog } from "@base-ui/react/alert-dialog";
import { LoaderCircle } from "lucide-react";
import { OUTLINE_PILL, PILL } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import { type ImportReport, undoFigures, undoQuestion } from "@/lib/imports";
import { cn } from "@/lib/utils";

// Undo's question: a sheet from the foot of a phone, centred from 640 px. The
// counts that make it weightier (studied, edited, moved) sit as figures, the
// way the report counts its steps, each with its line under it.

export function UndoDialog({
  open,
  report,
  busy,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  report: ImportReport;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const figures = undoFigures(report);
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
              {undoQuestion(report)}
            </AlertDialog.Description>
          </div>
          {figures.length > 0 && (
            <dl className="grid grid-cols-3 gap-2">
              {figures.map((figure) => (
                <div
                  key={figure.label}
                  className="flex flex-col gap-0.5 rounded-xl bg-muted/70 p-3"
                >
                  <dt className="sr-only">{figure.label}</dt>
                  <dd className="text-2xl font-semibold tabular-nums">{figure.n}</dd>
                  <dd className="text-xs leading-snug text-muted-foreground">
                    <span className="font-medium text-foreground">{figure.label}</span>,{" "}
                    {figure.note}
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
