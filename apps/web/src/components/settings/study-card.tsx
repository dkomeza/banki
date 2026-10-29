import { useId } from "react";
import { GlobalRetentionPicker, RetentionError } from "@/components/settings/retention-picker";
import { SaveState, SettingsCard } from "@/components/settings/parts";
import { protoState, useRetention } from "@/lib/proto-retention";

// PROTOTYPE (BAN-23, Variant a "Shelf"): the Study card, with the global
// Desired retention as a plain field like Auto-close's.

export function StudyCard() {
  const { saveState, ownCount } = useRetention();
  const label = useId();
  const hint = useId();
  return (
    <SettingsCard id="study" title="Study">
      <div className="flex flex-col gap-2">
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
        <p id={hint} className="text-sm text-muted-foreground">
          How likely you are to remember a card when it comes due. Higher means more reviews.
          {ownCount === 0
            ? " Every deck follows it."
            : ` Every deck follows it but the ${ownCount === 1 ? "one" : ownCount} with its own, set on the deck's page.`}
        </p>
        <RetentionError scope="global" />
      </div>
    </SettingsCard>
  );
}
