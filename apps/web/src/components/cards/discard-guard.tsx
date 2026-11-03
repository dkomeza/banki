import { AlertDialog } from "@base-ui/react/alert-dialog";
import { useBlocker } from "@tanstack/react-router";
import { useEffect, useLayoutEffect, useRef } from "react";
import { OUTLINE_PILL, PILL } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Asks "Discard changes?" before leaving a card editor while `unsaved`: by a
 * link, the breadcrumb, Cancel or back. Closing or reloading the tab gets the
 * browser's own prompt instead. With nothing unsaved it leaves without asking.
 * Renders the dialog in `dialog`; `release` lets the next navigation through,
 * for a save or a delete that leaves on purpose. While `holding` (a save or a
 * delete on its way, whose answer can still land), nothing leaves, unasked,
 * but the sign-in page: a 401 sends the User there, and signed out, nothing
 * on its way can land.
 */
export function useDiscardGuard(unsaved: boolean, holding = false) {
  // Refs, so a save that navigates straight after can let itself through
  // before React has rendered the saved state.
  const guarded = useRef(unsaved);
  const held = useRef(holding);
  useLayoutEffect(() => {
    guarded.current = unsaved;
    held.current = holding;
  }, [unsaved, holding]);
  const blocker = useBlocker({
    shouldBlockFn: ({ next }) => (held.current ? next.pathname !== "/login" : guarded.current),
    enableBeforeUnload: () => guarded.current || held.current,
    withResolver: true,
  });
  const staying = blocker.status === "blocked" && holding;
  useEffect(() => {
    if (staying) blocker.reset?.();
  }, [staying, blocker]);

  return {
    dialog: (
      <DiscardDialog
        open={blocker.status === "blocked" && !holding}
        onKeep={() => blocker.reset?.()}
        onDiscard={() => blocker.proceed?.()}
      />
    ),
    release: () => {
      guarded.current = false;
      held.current = false;
    },
  };
}

/** "Discard changes?", with Keep editing and Discard. */
export function DiscardDialog({
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
            Your changes to this card haven't been saved.
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
