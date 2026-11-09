import { AlertDialog } from "@base-ui/react/alert-dialog";
import { LoaderCircle } from "lucide-react";
import { OUTLINE_PILL, PILL } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { type UndoFacts, undoQuestion } from "./prototype";

// Variant a: Undo asks in a small centred dialog, as Delete permanently
// does: the question, then the counts that make it weightier as plain lines.

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
  const { question, lines } = undoQuestion(facts);
  return (
    <AlertDialog.Root open={open} onOpenChange={(next) => !next && !busy && onCancel()}>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="fixed inset-0 z-40 bg-foreground/30 backdrop-blur-[2px] transition-opacity data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 motion-reduce:transition-none dark:bg-black/50" />
        <AlertDialog.Popup className="fixed top-1/2 left-1/2 z-50 flex w-[min(28rem,calc(100vw-2.5rem))] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-[1.25rem] border bg-card p-6 text-card-foreground shadow-xl transition-[opacity,scale] data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0 motion-reduce:transition-none">
          <AlertDialog.Title className="text-xl font-semibold tracking-tight">
            Undo this import?
          </AlertDialog.Title>
          <AlertDialog.Description
            render={<div />}
            className="flex flex-col gap-2 text-[0.95rem] text-muted-foreground"
          >
            <p>{question}</p>
            {lines.length > 0 && (
              <ul className="flex flex-col gap-1 border-l-2 pl-3">
                {lines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}
          </AlertDialog.Description>
          <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
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
