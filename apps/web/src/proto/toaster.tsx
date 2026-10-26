// PROTOTYPE (BAN-12): Sonner, mounted once in the shell and styled to Paper &
// ink, with the "Card deleted" toast and its Undo. A Variant moves or restyles
// it through `TOASTER`.
import { useEffect, useRef } from "react";
import { Toaster, toast } from "sonner";
import { useThemeChoice } from "@/lib/theme";
import { type Card, deleteCard, restoreCard } from "./cards";

/** Where the toasts sit and how they look; each Variant sets its own. */
export const TOASTER: {
  position: "bottom-center" | "bottom-right" | "top-center";
  toast: string;
} = {
  position: "bottom-right",
  toast: "!rounded-2xl !border !border-border !bg-card !text-card-foreground !shadow-lg !font-sans",
};

export function ProtoToaster() {
  const [choice] = useThemeChoice();
  return (
    <Toaster
      theme={choice}
      position={TOASTER.position}
      // Clear of the tab bar below 1024 px.
      mobileOffset={{ bottom: "calc(4.75rem + env(safe-area-inset-bottom))" }}
      toastOptions={{
        classNames: {
          toast: TOASTER.toast,
          title: "!text-[0.95rem] !font-medium",
          actionButton:
            "!h-9 !rounded-full !bg-primary !px-4 !text-sm !font-medium !text-primary-foreground",
        },
      }}
    />
  );
}

/**
 * "Card deleted", with Undo, for about 8 s; hovering or focusing it keeps it
 * open (Sonner's own). `sticky` keeps it up for good, for the `undo` state.
 */
export function cardDeletedToast(card: Card, sticky = false) {
  toast("Card deleted", {
    id: `deleted-${card.id}`,
    duration: sticky ? Number.POSITIVE_INFINITY : 8000,
    action: {
      label: "Undo",
      onClick: () => {
        if (!restoreCard(card.id)) toast.error("Couldn't undo: the deck was deleted.");
      },
    },
  });
}

/** Deletes a Card and shows its toast. */
export function deleteWithUndo(card: Card, sticky = false) {
  const gone = deleteCard(card.id);
  if (gone !== undefined) cardDeletedToast(gone, sticky);
}

/** The `undo` state: the newest Card is deleted as the page opens, its toast kept up. */
export function useUndoState(state: string | undefined, newest: Card | undefined) {
  const done = useRef(false);
  useEffect(() => {
    if (state !== "undo" || done.current || newest === undefined) return;
    done.current = true;
    deleteWithUndo(newest, true);
  }, [state, newest]);
}
