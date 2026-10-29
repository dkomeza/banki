import { Dialog } from "@base-ui/react/dialog";
import { Link } from "@tanstack/react-router";
import { Calculator, Flag, PencilLine, X } from "lucide-react";
import { useId, useRef } from "react";
import { DeckRetentionPicker, RetentionError } from "@/components/settings/retention-picker";
import { SaveState } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import { protoState, useRetention } from "@/lib/proto-retention";
import { cn } from "@/lib/utils";

// PROTOTYPE (BAN-23, Variant c "Drawer"): a Deck's settings open in a dialog
// from the deck page (a sheet from the bottom on phones), out of the way of
// its Cards. Desired retention reads as a picture: ten cards coming due, the
// ones you'll remember filled in.

const LATER = [
  {
    icon: PencilLine,
    label: "Answer mode",
    note: "Write answers for the Grader, or rate yourself",
  },
  { icon: Calculator, label: "Math macros", note: "Shorthands for this deck's Formulas" },
  { icon: Flag, label: "Plan", note: "An exam date that raises retention as it nears" },
] as const;

export function DeckSettingsDialog({
  deck,
  open,
  onOpenChange,
}: {
  deck: { id: string; name: string };
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const popup = useRef<HTMLDivElement>(null);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-foreground/30 backdrop-blur-[2px] transition-opacity data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 motion-reduce:transition-none dark:bg-black/50" />
        <Dialog.Popup
          ref={popup}
          // The dialog itself, not its first link; the picking state focuses the picker.
          initialFocus={protoState() === "picking" ? true : popup}
          className="outline-none sm:min-h-[min(37rem,84svh)] fixed inset-x-0 bottom-0 z-50 flex max-h-[92svh] flex-col gap-6 overflow-y-auto rounded-t-[1.5rem] border bg-card p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] text-card-foreground shadow-xl transition-[opacity,translate] data-[ending-style]:translate-y-8 data-[ending-style]:opacity-0 data-[starting-style]:translate-y-8 data-[starting-style]:opacity-0 motion-reduce:transition-none sm:top-[8svh] sm:bottom-auto sm:left-1/2 sm:max-h-[84svh] sm:w-[min(34rem,calc(100vw-3rem))] sm:-translate-x-1/2 sm:rounded-[1.25rem] sm:pb-6"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 flex-col gap-1">
              <Dialog.Title className="text-2xl font-semibold tracking-tight">
                Deck settings
              </Dialog.Title>
              <Dialog.Description className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
                {deck.name}. Anything it doesn't set follows{" "}
                <Link to="/settings" className="text-foreground underline underline-offset-4">
                  Settings
                </Link>
                .
              </Dialog.Description>
            </div>
            <Dialog.Close
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  className="-mt-1.5 -mr-2 size-11 rounded-full lg:size-9"
                />
              }
              aria-label="Close"
            >
              <X aria-hidden />
            </Dialog.Close>
          </div>
          {open && <Retention deckId={deck.id} />}
          <div className="mt-auto flex flex-col gap-2 border-t pt-5">
            <p className="text-sm font-medium text-muted-foreground">Coming later</p>
            <ul className="flex flex-col gap-3">
              {LATER.map(({ icon: Icon, label, note }) => (
                <li key={label} className="flex items-start gap-3 text-[0.95rem]">
                  <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <span>
                    <span className="font-medium">{label}</span>
                    <span className="text-muted-foreground"> · {note}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Retention({ deckId }: { deckId: string }) {
  const { effective, own, global, saveState } = useRetention();
  const label = useId();
  const hint = useId();
  const scope = { deck: deckId };
  const value = effective(deckId);
  return (
    <section aria-labelledby={label} className="flex flex-col gap-3">
      <div className="flex min-h-5 items-center justify-between gap-3">
        <span id={label} className="text-sm font-medium">
          Desired retention
        </span>
        <SaveState state={saveState(scope)} />
      </div>
      <DeckRetentionPicker
        deckId={deckId}
        labelledBy={label}
        describedBy={hint}
        autoFocus={protoState() === "picking"}
      />
      <RetentionPicture percent={value} />
      <p id={hint} className="text-sm text-muted-foreground">
        {own(deckId) === null
          ? `Follows Settings, ${global}% now. `
          : `Its own, whatever Settings say (${global}% now). `}
        Of every 100 of its cards that come due, you'll remember about {value}.
      </p>
      <RetentionError scope={scope} />
    </section>
  );
}

/**
 * Ten cards coming due, each a tenth of them: what you'll remember fills them
 * in the accent, so 85% is eight and a half cards.
 */
export function RetentionPicture({ percent, className }: { percent: number; className?: string }) {
  return (
    <div aria-hidden className={cn("flex items-center gap-1.5", className)}>
      {Array.from({ length: 10 }, (_, index) => {
        const filled = Math.min(Math.max(percent / 10 - index, 0), 1);
        return (
          <span
            key={index}
            className={cn(
              "relative h-7 flex-1 overflow-hidden rounded-md border sm:h-8",
              filled === 1 ? "border-primary" : "border-dashed border-input bg-background",
            )}
          >
            <span
              className="absolute inset-y-0 left-0 bg-primary transition-[width] motion-reduce:transition-none"
              style={{ width: `${filled * 100}%` }}
            />
          </span>
        );
      })}
    </div>
  );
}
