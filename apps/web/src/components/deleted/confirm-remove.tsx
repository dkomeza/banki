import { AlertDialog } from "@base-ui/react/alert-dialog";
import { OUTLINE_PILL, PILL } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import { type Deletion, deleteQuestion } from "@/lib/deletions-proto";
import { cn } from "@/lib/utils";

/** Asks before a Deletion is deleted permanently, naming what goes. */
export function ConfirmRemove({
  deletion,
  onCancel,
  onConfirm,
}: {
  deletion: Deletion | undefined;
  onCancel: () => void;
  onConfirm: (d: Deletion) => void;
}) {
  return (
    <AlertDialog.Root open={deletion !== undefined} onOpenChange={(open) => !open && onCancel()}>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="fixed inset-0 z-40 bg-foreground/30 backdrop-blur-[2px] transition-opacity data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 motion-reduce:transition-none dark:bg-black/50" />
        <AlertDialog.Popup className="fixed top-1/2 left-1/2 z-50 flex w-[min(28rem,calc(100vw-2.5rem))] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-[1.25rem] border bg-card p-6 text-card-foreground shadow-xl transition-[opacity,scale] data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0 motion-reduce:transition-none">
          <AlertDialog.Title className="text-xl font-semibold tracking-tight">
            Delete permanently?
          </AlertDialog.Title>
          <AlertDialog.Description className="text-[0.95rem] text-muted-foreground [overflow-wrap:anywhere]">
            {deletion && deleteQuestion(deletion)}
          </AlertDialog.Description>
          <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialog.Close render={<Button variant="outline" className={OUTLINE_PILL} />}>
              Cancel
            </AlertDialog.Close>
            <Button
              className={cn(PILL, "bg-destructive text-primary-foreground hover:bg-destructive/85")}
              onClick={() => deletion && onConfirm(deletion)}
            >
              Delete permanently
            </Button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
