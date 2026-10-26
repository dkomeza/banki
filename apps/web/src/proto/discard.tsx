// PROTOTYPE (BAN-12): "Discard changes?" before leaving an editor with changes
// not saved: a link, the breadcrumb, Cancel or back. Closing or reloading the
// tab gets the browser's own prompt.
import { AlertDialog } from "@base-ui/react/alert-dialog";
import { useBlocker } from "@tanstack/react-router";
import { useLayoutEffect, useRef, useState } from "react";
import { OUTLINE_PILL, PILL } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Blocks leaving while `dirty`, and renders the dialog that asks. `forced`
 * opens it at once (the `discard` state), going to `onForcedDiscard` on
 * Discard.
 */
export function useDiscardGuard(dirty: boolean, forced: boolean, onForcedDiscard: () => void) {
  // A ref, so a save that navigates straight after can let itself through.
  const guarded = useRef(dirty);
  useLayoutEffect(() => {
    guarded.current = dirty;
  }, [dirty]);
  const blocker = useBlocker({
    shouldBlockFn: () => guarded.current,
    enableBeforeUnload: () => guarded.current,
    withResolver: true,
  });
  const [forcedOpen, setForcedOpen] = useState(forced);
  const open = blocker.status === "blocked" || forcedOpen;
  const dialog = (
    <DiscardDialog
      open={open}
      onKeep={() => {
        setForcedOpen(false);
        if (blocker.status === "blocked") blocker.reset();
      }}
      onDiscard={() => {
        if (blocker.status === "blocked") blocker.proceed();
        else {
          setForcedOpen(false);
          onForcedDiscard();
        }
      }}
    />
  );
  return {
    dialog,
    /** Lets the next navigation through, after a save or a delete. */
    release: () => {
      guarded.current = false;
    },
  };
}

function DiscardDialog({
  open,
  onKeep,
  onDiscard,
}: {
  open: boolean;
  onKeep: () => void;
  onDiscard: () => void;
}) {
  return (
    <AlertDialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onKeep();
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="fixed inset-0 z-40 bg-foreground/30 backdrop-blur-[2px] transition-opacity data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 motion-reduce:transition-none dark:bg-black/50" />
        <AlertDialog.Popup className="fixed top-1/2 left-1/2 z-50 flex w-[min(26rem,calc(100vw-2.5rem))] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-[1.25rem] border bg-card p-6 text-card-foreground shadow-xl transition-[opacity,scale] data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0 motion-reduce:transition-none">
          <AlertDialog.Title className="text-xl font-semibold tracking-tight">
            Discard changes?
          </AlertDialog.Title>
          <AlertDialog.Description className="text-[0.95rem] text-muted-foreground">
            What you've written on this card hasn't been saved.
          </AlertDialog.Description>
          <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialog.Close render={<Button variant="outline" className={OUTLINE_PILL} />}>
              Keep editing
            </AlertDialog.Close>
            <Button
              className={cn(PILL, "bg-destructive text-primary-foreground hover:bg-destructive/85")}
              onClick={onDiscard}
            >
              Discard
            </Button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
