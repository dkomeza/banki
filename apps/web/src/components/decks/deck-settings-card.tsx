import { Link } from "@tanstack/react-router";
import { useId, useState } from "react";
import { DeckRetentionPicker, RetentionError } from "@/components/settings/retention-picker";
import { OUTLINE_PILL, SaveState } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import { protoState, useRetention } from "@/lib/proto-retention";
import { cn } from "@/lib/utils";

// PROTOTYPE (BAN-23, Variant a "Shelf"): a Deck's settings live on its own
// page, in one card under the header. Each setting is a row with its value
// and Change beside it; Change opens the picker in place. Settings to come
// sit in the same card as quiet rows, so the card is where they'll land.

const LATER = [
  { label: "Math macros", value: "Uses Settings' macros" },
  { label: "Answer mode", value: "Rate yourself" },
  { label: "Plan", value: "None" },
] as const;

export function DeckSettingsCard({ deckId }: { deckId: string }) {
  const start = protoState();
  const [open, setOpen] = useState(start === "picking" || start === "save-error");
  const { global, own, saveState, failure } = useRetention();
  const value = own(deckId);
  const label = useId();
  const hint = useId();
  const scope = { deck: deckId };

  return (
    <section
      aria-labelledby="deck-settings-title"
      className="flex flex-col gap-1 rounded-[1.25rem] border bg-card p-5 text-card-foreground sm:p-6"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 pb-3">
        <h2 id="deck-settings-title" className="text-xl font-semibold tracking-tight">
          Deck settings
        </h2>
        <p className="text-sm text-muted-foreground">
          The rest come from{" "}
          <Link to="/settings" className="text-foreground underline underline-offset-4">
            Settings
          </Link>
        </p>
      </div>

      <div className="flex flex-col gap-3 border-t pt-4 pb-4">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-3">
              <p id={label} className="text-sm text-muted-foreground">
                Desired retention
              </p>
              <SaveState state={saveState(scope)} />
            </div>
            <p className="text-[1.05rem] font-medium">
              {value === null ? (
                <>
                  {global}%{" "}
                  <span className="font-normal text-muted-foreground">· follows Settings</span>
                </>
              ) : (
                <>
                  {value}%{" "}
                  <span className="font-normal text-muted-foreground">
                    · its own (Settings: {global}%)
                  </span>
                </>
              )}
            </p>
          </div>
          <Button
            variant="outline"
            className={cn(OUTLINE_PILL, "h-11")}
            aria-expanded={open}
            onClick={() => setOpen((was) => !was)}
          >
            {open ? "Done" : "Change"}
          </Button>
        </div>
        {(open || failure(scope) !== undefined) && (
          <div className="flex flex-col gap-3 rounded-xl bg-muted p-4">
            <DeckRetentionPicker
              deckId={deckId}
              labelledBy={label}
              describedBy={hint}
              autoFocus={start === "picking"}
            />
            <p id={hint} className="text-sm text-muted-foreground">
              How likely you are to remember a card of this deck when it comes due. Higher means
              more reviews. A change reschedules its cards at once.
            </p>
            <RetentionError scope={scope} />
          </div>
        )}
      </div>

      {LATER.map((row) => (
        <div
          key={row.label}
          aria-disabled
          className="flex items-center gap-3 border-t pt-4 pb-4 last:pb-0"
        >
          <div className="min-w-0 flex-1 opacity-60">
            <p className="text-sm text-muted-foreground">{row.label}</p>
            <p className="text-[1.05rem] font-medium">{row.value}</p>
          </div>
          <span className="rounded-full border border-dashed px-3 py-1 text-xs text-muted-foreground">
            Coming later
          </span>
        </div>
      ))}
    </section>
  );
}
