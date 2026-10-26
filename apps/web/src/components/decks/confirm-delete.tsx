import { AlertDialog } from "@base-ui/react/alert-dialog";
import { type ReactNode, useState } from "react";
import { FormError } from "@/components/auth-card";
import { OUTLINE_PILL, PILL } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Asks before a Deck is deleted, naming it, or a Folder, given its own
 * `title`, `description` and `confirmLabel`. `onConfirm` deletes it,
 * answering a message when that failed, which shows in the dialog.
 */
export function ConfirmDelete({
  open,
  onOpenChange,
  name,
  title = "Delete this deck?",
  description,
  confirmLabel = "Delete deck",
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  title?: string;
  description?: ReactNode;
  confirmLabel?: string;
  onConfirm: () => Promise<string | undefined>;
}) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string>();

  const confirm = async () => {
    setDeleting(true);
    setError(undefined);
    const failed = await onConfirm();
    setDeleting(false);
    setError(failed);
  };

  return (
    <AlertDialog.Root
      open={open}
      onOpenChange={(next) => {
        if (deleting) return;
        if (!next) setError(undefined);
        onOpenChange(next);
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="fixed inset-0 z-40 bg-foreground/30 backdrop-blur-[2px] transition-opacity data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 motion-reduce:transition-none dark:bg-black/50" />
        <AlertDialog.Popup className="fixed top-1/2 left-1/2 z-50 flex w-[min(28rem,calc(100vw-2.5rem))] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-[1.25rem] border bg-card p-6 text-card-foreground shadow-xl transition-[opacity,scale] data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0 motion-reduce:transition-none">
          <AlertDialog.Title className="text-xl font-semibold tracking-tight">
            {title}
          </AlertDialog.Title>
          <AlertDialog.Description className="text-[0.95rem] text-muted-foreground">
            {description ?? (
              <>
                <span className="font-medium text-foreground [overflow-wrap:anywhere]">
                  “{name}”
                </span>{" "}
                and its cards will be deleted.
              </>
            )}{" "}
            You can restore it from Recently deleted for 30 days.
          </AlertDialog.Description>
          {error !== undefined && <FormError>{error}</FormError>}
          <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialog.Close
              render={<Button variant="outline" className={OUTLINE_PILL} disabled={deleting} />}
            >
              Cancel
            </AlertDialog.Close>
            <Button
              className={cn(PILL, "bg-destructive text-primary-foreground hover:bg-destructive/85")}
              disabled={deleting}
              onClick={() => void confirm()}
            >
              {deleting ? "Deleting…" : confirmLabel}
            </Button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
