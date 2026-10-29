import { useId } from "react";
import { RetentionPicture } from "@/components/decks/deck-settings-dialog";
import { GlobalRetentionPicker, RetentionError } from "@/components/settings/retention-picker";
import { SaveState, SettingsCard } from "@/components/settings/parts";
import { protoState, useRetention } from "@/lib/proto-retention";

// PROTOTYPE (BAN-23, Variant c "Drawer"): the Study card, with the global
// Desired retention and the picture of what it means.

export function StudyCard() {
  const { global, saveState, ownCount } = useRetention();
  const label = useId();
  const hint = useId();
  return (
    <SettingsCard id="study" title="Study">
      <div className="flex flex-col gap-3">
        <div className="flex min-h-5 items-center justify-between gap-3">
          <span id={label} className="text-sm font-medium">
            Desired retention
          </span>
          <SaveState state={saveState("global")} />
        </div>
        <GlobalRetentionPicker
          labelledBy={label}
          describedBy={hint}
          autoFocus={protoState() === "picking"}
        />
        <RetentionPicture percent={global} />
        <p id={hint} className="text-sm text-muted-foreground">
          Of every 100 cards that come due, you'll remember about {global}. Higher means more
          reviews.{" "}
          {ownCount === 0
            ? "Every deck follows it unless you give it its own, in its Deck settings."
            : `Every deck follows it but ${ownCount === 1 ? "one" : ownCount}, which ${ownCount === 1 ? "has its" : "have their"} own.`}
        </p>
        <RetentionError scope="global" />
      </div>
    </SettingsCard>
  );
}
